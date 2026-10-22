import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { escapeLike } from '@/lib/portal-360/data'
import { isClientVisibleInvoice } from '@/lib/portal-360/dashboard'
import { generateInvoicePdf } from '@/lib/invoices/pdf'
import { withFreshConsolidatedDescriptions } from '@/lib/invoices/consolidated-items'
import type { Customer, Invoice, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * PDF da fatura para o CLIENTE no portal. Mesmo documento que o escritório envia, mas a autorização aqui é o vínculo da fatura com um cadastro do próprio
 * cliente (customers.client_company) via chave de serviço — nunca RLS (o login de cliente não tem empresa). Só faturas emitidas (enviadas ou pagas).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params
  const appUser = await getAppUser()
  if (!appUser || appUser.role !== 'client' || !appUser.clientCompany) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const supabase = createServiceClient()
  if (!supabase) return NextResponse.json({ error: 'Service temporarily unavailable.' }, { status: 503 })

  const { data: invoiceRow } = await supabase.from('invoices').select('*').eq('id', invoiceId).maybeSingle()
  const invoice = invoiceRow as Invoice | null
  if (!invoice || !isClientVisibleInvoice(invoice.status)) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })

  const { data: customerRow } = await supabase.from('customers').select('*').eq('id', invoice.customer_id).ilike('client_company', escapeLike(appUser.clientCompany)).maybeSingle()
  const customer = customerRow as Customer | null
  if (!customer) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })

  const { data: unitRow } = await supabase.from('units').select('*').eq('id', invoice.unit_id).maybeSingle()
  if (!unitRow) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })

  const fresh = await withFreshConsolidatedDescriptions(supabase, invoice)
  // O portal do cliente é sempre em inglês: o PDF também.
  const pdf = await generateInvoicePdf({ invoice: fresh, customer, unit: unitRow as Unit, locale: 'en' })
  const safe = invoice.invoice_number.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="invoice-${safe}.pdf"`, 'Cache-Control': 'private, no-store' },
  })
}
