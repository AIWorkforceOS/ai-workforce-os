import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendInvoiceEmail } from '@/lib/email'
import { logSystemEvent } from '@/lib/system-events'
import { unitDefaultLocale } from '@/lib/i18n/config'
import type { Customer, Invoice, Unit } from '@/lib/types'

/**
 * Envia (ou reenvia) a fatura por e-mail ao cliente final e marca
 * status='sent' (migration 030). Diferente dos avisos de agenda, aqui a
 * falha É erro para o usuário: quem clicou "Enviar fatura" precisa saber
 * na hora se o e-mail não saiu (destinatário sem e-mail, Resend fora do
 * ar) — não existe um "depois" implícito que corrija sozinho.
 * Todas as leituras/escritas passam pelo client com RLS do usuário.
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

  const { data: customerRow } = await supabase
    .from('customers')
    .select('*')
    .eq('id', invoice.customer_id)
    .maybeSingle()
  const customer = customerRow as Customer | null
  if (!customer) {
    return NextResponse.json({ error: 'Cliente da fatura não encontrado.' }, { status: 404 })
  }
  if (!customer.email) {
    return NextResponse.json(
      { error: 'Este cliente não tem e-mail cadastrado. Adicione um e-mail na tela de Clientes antes de enviar.' },
      { status: 400 },
    )
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
    locale: unitDefaultLocale(unit),
    // Resposta do cliente cai na caixa real da empresa (não no agente): fatura é assunto humano.
    replyTo: unit.email_reply_to,
  })

  if (!result.ok) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'invoices',
      eventType: 'invoice_send_failed',
      message: `Falha ao enviar a fatura ${invoice.invoice_number} para ${customer.email}: ${result.error ?? 'erro desconhecido'}.`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
    return NextResponse.json({ error: result.error ?? 'Não foi possível enviar o e-mail.' }, { status: 502 })
  }

  // status 'paid' não regride para 'sent' num reenvio (recibo de cortesia).
  const { data: updated } = await supabase
    .from('invoices')
    .update({
      status: invoice.status === 'paid' ? 'paid' : 'sent',
      sent_at: new Date().toISOString(),
      sent_to_email: customer.email,
    })
    .eq('id', invoice.id)
    .select()
    .single()

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'invoices',
    eventType: 'invoice_sent',
    message: `Fatura ${invoice.invoice_number} (${invoice.currency} ${invoice.amount}) enviada para ${customer.email}.`,
    orgId: unit.org_id,
    unitId: unit.id,
  })

  return NextResponse.json({ ok: true, invoice: updated })
}
