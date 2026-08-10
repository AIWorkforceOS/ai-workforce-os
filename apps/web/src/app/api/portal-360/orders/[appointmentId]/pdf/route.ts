import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { generateServiceOrderPdf } from '@/lib/service-orders/pdf'

type ServiceOrderPdfRow = {
  service_order_number: string | null
  service_order_client_po: string | null
  service_order_priority: string | null
  service_order_order_type: string | null
  service_order_ivr_pin: string | null
  service_order_location_name: string | null
  service_order_location_phone: string | null
  service_order_issuer_name: string | null
  service_order_issuer_email: string | null
  service_order_scope_en: string | null
  service_order_signed_by: string | null
  service_order_signed_at: string | null
  service_order_signature_url: string | null
  address: string | null
  starts_at: string
}

/**
 * Baixa o mesmo PDF (Sign Off Sheet) que o admin/técnico já geram —
 * ver app/api/units/[id]/appointments/[appointmentId]/service-order/pdf.
 * Não reaproveita aquela rota porque a autorização ali é RLS (client
 * autenticado do usuário); aqui o usuário 'client' não tem RLS
 * nenhuma de propósito (org_id NULL, ver migration 061) — a
 * autorização de verdade é o join `customers!inner(client_company)`
 * abaixo, via service role.
 */
export async function GET(request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
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
    .select(
      'service_order_number, service_order_client_po, service_order_priority, service_order_order_type, service_order_ivr_pin, service_order_location_name, service_order_location_phone, service_order_issuer_name, service_order_issuer_email, service_order_scope_en, service_order_signed_by, service_order_signed_at, service_order_signature_url, address, starts_at, customers!inner(client_company)',
    )
    .eq('id', appointmentId)
    .eq('customers.client_company', appUser.clientCompany)
    .maybeSingle()

  const appointment = data as unknown as ServiceOrderPdfRow | null
  if (!appointment) {
    return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
  }

  const pdfBuffer = await generateServiceOrderPdf({ appointment })

  const safeNumber = (appointment.service_order_number ?? appointmentId).replace(/[^a-zA-Z0-9.\-_]/g, '_')

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="service-order-${safeNumber}.pdf"`,
    },
  })
}
