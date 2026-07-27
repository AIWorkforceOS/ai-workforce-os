import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendInvoiceEmail } from '@/lib/email'
import { generateInvoicePdf } from '@/lib/invoices/pdf'
import { buildInvoiceMessageText, getMessagingChannel } from '@/lib/channels/messaging-channel'
import { logSystemEvent } from '@/lib/system-events'
import { unitDefaultLocale } from '@/lib/i18n/config'
import type { Customer, Invoice, Unit } from '@/lib/types'

/**
 * Envia (ou reenvia) a fatura ao cliente final por todos os canais que
 * ele tiver cadastrado — e-mail (Resend) e telefone (WhatsApp/SMS,
 * conforme getMessagingChannel da unidade) — e marca status='sent'
 * (migration 030/039). Cada canal falha de forma independente (mesmo
 * padrão gracioso de sendToLeadChannels): só retorna erro ao usuário se
 * NENHUM canal disponível conseguiu enviar, porque quem clicou "Enviar
 * fatura" precisa saber na hora se nada saiu — não existe um "depois"
 * implícito que corrija sozinho. Todas as leituras/escritas passam pelo
 * client com RLS do usuário.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; invoiceId: string }> },
) {
  const { id, invoiceId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const { data: unitRow } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unitRow) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }
  const unit = unitRow as Unit

  const { data: invoiceRow } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('unit_id', id)
    .maybeSingle()
  const invoice = invoiceRow as Invoice | null
  if (!invoice) {
    return NextResponse.json({ error: 'Fatura não encontrada.' }, { status: 404 })
  }
  if (invoice.status === 'cancelled') {
    return NextResponse.json({ error: 'Fatura cancelada não pode ser enviada.' }, { status: 400 })
  }
  if (invoice.status === 'consolidated') {
    return NextResponse.json(
      { error: 'Esta fatura foi incluída numa fatura consolidada — envie a fatura consolidada em vez desta.' },
      { status: 400 },
    )
  }

  const { data: customerRow } = await supabase
    .from('customers')
    .select('*')
    .eq('id', invoice.customer_id)
    .maybeSingle()
  const customer = customerRow as Customer | null
  if (!customer) {
    return NextResponse.json({ error: 'Cliente da fatura não encontrado.' }, { status: 404 })
  }
  if (!customer.email && !customer.phone) {
    return NextResponse.json(
      { error: 'Este cliente não tem e-mail nem telefone cadastrado. Adicione um contato na tela de Clientes antes de enviar.' },
      { status: 400 },
    )
  }

  const locale = unitDefaultLocale(unit)
  const attempts: { channel: 'email' | 'phone'; ok: boolean; error?: string }[] = []

  if (customer.email) {
    // PDF é best-effort: se a geração falhar, o e-mail ainda sai com os
    // dados da fatura no corpo — não faz sentido bloquear o envio inteiro
    // por causa do anexo.
    let attachment: { filename: string; content: string } | null = null
    try {
      const pdfBuffer = await generateInvoicePdf({ invoice, customer, unit, locale })
      attachment = { filename: `fatura-${invoice.invoice_number}.pdf`, content: pdfBuffer.toString('base64') }
    } catch (error) {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'invoices',
        eventType: 'invoice_pdf_generation_failed',
        message: `Não foi possível gerar o PDF da fatura ${invoice.invoice_number}: ${error instanceof Error ? error.message : 'erro desconhecido'}.`,
        orgId: unit.org_id,
        unitId: unit.id,
      })
    }

    const result = await sendInvoiceEmail({
      to: customer.email,
      unitName: unit.name,
      logoUrl: unit.logo_url,
      customerName: customer.name,
      invoiceNumber: invoice.invoice_number,
      description: invoice.description,
      amount: Number(invoice.amount),
      currency: invoice.currency,
      dueDate: invoice.due_date,
      paymentNotes: invoice.notes,
      locale,
      consolidatedItems: invoice.consolidated_items,
      // Resposta do cliente cai na caixa real da empresa (não no agente): fatura é assunto humano.
      replyTo: unit.email_reply_to,
      attachment,
    })
    attempts.push({ channel: 'email', ok: result.ok, error: result.error })
  }

  if (customer.phone) {
    const channel = getMessagingChannel(unit)
    if (channel) {
      try {
        const text = buildInvoiceMessageText({
          unitName: unit.name,
          customerName: customer.name,
          invoiceNumber: invoice.invoice_number,
          description: invoice.description,
          amount: Number(invoice.amount),
          currency: invoice.currency,
          dueDate: invoice.due_date,
          paymentNotes: invoice.notes,
          locale,
          consolidatedItems: invoice.consolidated_items,
        })
        await channel.sendMessage(customer.phone, text)
        attempts.push({ channel: 'phone', ok: true })
      } catch (error) {
        attempts.push({
          channel: 'phone',
          ok: false,
          error: error instanceof Error ? error.message : 'Erro desconhecido.',
        })
      }
    }
  }

  for (const attempt of attempts) {
    if (attempt.ok) continue
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'invoices',
      eventType: 'invoice_send_failed',
      message: `Falha ao enviar a fatura ${invoice.invoice_number} por ${attempt.channel === 'email' ? 'e-mail' : 'telefone'}: ${attempt.error ?? 'erro desconhecido'}.`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
  }

  const sentByEmail = attempts.some((a) => a.channel === 'email' && a.ok)
  const sentByPhone = attempts.some((a) => a.channel === 'phone' && a.ok)

  if (!sentByEmail && !sentByPhone) {
    const combinedError = attempts.map((a) => a.error).filter(Boolean).join(' / ') || 'Não foi possível enviar a fatura.'
    return NextResponse.json({ error: combinedError }, { status: 502 })
  }

  // status 'paid' não regride para 'sent' num reenvio (recibo de cortesia).
  const { data: updated } = await supabase
    .from('invoices')
    .update({
      status: invoice.status === 'paid' ? 'paid' : 'sent',
      sent_at: new Date().toISOString(),
      ...(sentByEmail ? { sent_to_email: customer.email } : {}),
      ...(sentByPhone ? { sent_to_phone: customer.phone } : {}),
    })
    .eq('id', invoice.id)
    .select()
    .single()

  const channelsSent = [sentByEmail ? 'e-mail' : null, sentByPhone ? 'telefone' : null].filter(Boolean).join(' e ')
  await logSystemEvent(supabase, {
    level: 'info',
    source: 'invoices',
    eventType: 'invoice_sent',
    message: `Fatura ${invoice.invoice_number} (${invoice.currency} ${invoice.amount}) enviada por ${channelsSent} para ${customer.name}.`,
    orgId: unit.org_id,
    unitId: unit.id,
  })

  return NextResponse.json({ ok: true, invoice: updated })
}
