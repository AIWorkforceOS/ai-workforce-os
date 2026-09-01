import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateInvoicePdf } from '@/lib/invoices/pdf'
import { unitDefaultLocale } from '@/lib/i18n/config'
import type { Customer, Invoice, Unit } from '@/lib/types'

/**
 * Baixa o PDF da fatura direto (pedido do Vinicius, 2026-08-31) —
 * diferente de POST .../send (que gera o MESMO PDF só como anexo de
 * e-mail/mensagem e marca status='sent'), esta rota não manda nada nem
 * muda status, só devolve os bytes pra download. Disponível pra qualquer
 * status (inclusive cancelada/paga) — é só o documento, sem efeito
 * colateral. Client autenticado do próprio usuário, mesma RLS de
 * invoices_select já cobre a autorização.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; invoiceId: string }> },
) {
  const { id: unitId, invoiceId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const { data: unitRow } = await supabase.from('units').select('*').eq('id', unitId).maybeSingle()
  if (!unitRow) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }
  const unit = unitRow as Unit

  const { data: invoiceRow } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('unit_id', unitId)
    .maybeSingle()
  const invoice = invoiceRow as Invoice | null
  if (!invoice) {
    return NextResponse.json({ error: 'Fatura não encontrada.' }, { status: 404 })
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

  const locale = unitDefaultLocale(unit)
  const pdfBuffer = await generateInvoicePdf({ invoice, customer, unit, locale })

  const safeNumber = invoice.invoice_number.replace(/[^a-zA-Z0-9.\-_]/g, '_')

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="fatura-${safeNumber}.pdf"`,
    },
  })
}
