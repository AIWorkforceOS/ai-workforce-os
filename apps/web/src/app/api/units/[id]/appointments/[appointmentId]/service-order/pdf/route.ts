import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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
  service_order_summary_pt: string | null
  service_order_signed_by: string | null
  service_order_signed_at: string | null
  service_order_signature_url: string | null
  address: string | null
  starts_at: string
}

/**
 * Baixa o PDF do "Sign Off Sheet" (modelo fixo da 360, ver
 * lib/service-orders/pdf.ts) — usado tanto pelo técnico (Portal do
 * Funcionário, depois de assinar) quanto pelo admin (painel de
 * agendamentos). Client autenticado do próprio usuário: a RLS de
 * appointments_select já cobre os dois casos (o técnico só vê a
 * própria linha via current_app_employee_id(), migration 053; o admin
 * vê tudo da org) — mesmo padrão de autorização da rota PATCH deste
 * mesmo recurso.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; appointmentId: string }> },
) {
  const { id: unitId, appointmentId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const { data } = await supabase
    .from('appointments')
    .select(
      'service_order_number, service_order_client_po, service_order_priority, service_order_order_type, service_order_ivr_pin, service_order_location_name, service_order_location_phone, service_order_issuer_name, service_order_issuer_email, service_order_summary_pt, service_order_signed_by, service_order_signed_at, service_order_signature_url, address, starts_at',
    )
    .eq('id', appointmentId)
    .eq('unit_id', unitId)
    .maybeSingle()

  const appointment = data as unknown as ServiceOrderPdfRow | null
  if (!appointment) {
    return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 })
  }

  const { data: unit } = await supabase.from('units').select('name').eq('id', unitId).maybeSingle()

  const pdfBuffer = await generateServiceOrderPdf({
    appointment,
    unitName: (unit as { name: string } | null)?.name ?? '',
  })

  const safeNumber = (appointment.service_order_number ?? appointmentId).replace(/[^a-zA-Z0-9.\-_]/g, '_')

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ordem-servico-${safeNumber}.pdf"`,
    },
  })
}
