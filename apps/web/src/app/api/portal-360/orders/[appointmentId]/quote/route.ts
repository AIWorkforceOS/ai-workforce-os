import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { composeClientQuoteDescription } from '@/lib/service-orders/quote-composer'

/**
 * Gera (ou regenera) a cotação estruturada por IA — botão manual no
 * Portal 360, ver lib/service-orders/quote-composer.ts. Mesmo padrão de
 * autorização das outras rotas deste portal (service role + join
 * `customers!inner(client_company)`, nunca RLS — ver pdf/route.ts
 * vizinha).
 */
export async function POST(request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = await params

  const appUser = await getAppUser()
  if (!appUser || appUser.role !== 'client' || !appUser.clientCompany) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Service temporarily unavailable.' }, { status: 503 })
  }

  const { data } = await supabase
    .from('appointments')
    .select('id, service_order_material_description, customers!inner(client_company)')
    .eq('id', appointmentId)
    .eq('customers.client_company', appUser.clientCompany)
    .maybeSingle()

  const order = data as { id: string; service_order_material_description: string | null } | null
  if (!order) {
    return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
  }
  if (!order.service_order_material_description?.trim()) {
    return NextResponse.json({ error: 'The technician has not left any notes about what is needed yet.' }, { status: 400 })
  }

  const quote = await composeClientQuoteDescription(order.service_order_material_description)
  if (!quote) {
    return NextResponse.json({ error: 'Could not generate the quote right now. Try again in a moment.' }, { status: 502 })
  }

  const { error: updateError } = await supabase
    .from('appointments')
    .update({ service_order_quote_description_en: quote.en, service_order_quote_description_pt: quote.pt })
    .eq('id', appointmentId)

  if (updateError) {
    return NextResponse.json({ error: 'Generated the quote but could not save it.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, quoteEn: quote.en, quotePt: quote.pt })
}
