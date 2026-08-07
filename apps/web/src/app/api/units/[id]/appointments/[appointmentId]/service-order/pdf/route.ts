import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { PortalServiceOrderPhoto } from '@/lib/portal-funcionario/data'
import { generateServiceOrderPdf } from '@/lib/service-orders/pdf'

type ServiceOrderPdfRow = {
  service_order_number: string | null
  service_order_status: 'pending' | 'completed' | 'quote'
  service_order_summary_pt: string | null
  service_order_signed_by: string | null
  service_order_signed_at: string | null
  service_order_signature_url: string | null
  service_order_material_description: string | null
  service_order_material_value: number | null
  service_order_hours_needed: number | null
  service_order_part_purchase_link: string | null
  service_order_photos: PortalServiceOrderPhoto[]
  address: string | null
  starts_at: string
  customer: { name: string } | null
}

/**
 * Baixa o PDF preenchido da ordem de serviço (assinatura, fotos,
 * material, horas) — usado tanto pelo técnico (Portal do Funcionário,
 * depois de salvar) quanto pelo admin (painel de agendamentos). Client
 * autenticado do próprio usuário: a RLS de appointments_select já cobre
 * os dois casos (o técnico só vê a própria linha via
 * current_app_employee_id(), migration 053; o admin vê tudo da org) —
 * mesmo padrão de autorização da rota PATCH deste mesmo recurso.
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
      'service_order_number, service_order_status, service_order_summary_pt, service_order_signed_by, service_order_signed_at, service_order_signature_url, service_order_material_description, service_order_material_value, service_order_hours_needed, service_order_part_purchase_link, service_order_photos, address, starts_at, customer:customers(name)',
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
    customerName: appointment.customer?.name ?? null,
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
