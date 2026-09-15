import { DEFAULT_CLIENT_COMPANY_NAME } from './portal-360/constants'
import type { MappedFacilitOrder } from './facilit'

/**
 * appointments.source pra uma linha criada pelo sync da Facil-IT —
 * mesmo mecanismo do Portal 360 (employee_id NULL + este source =
 * "pendente de atribuição" reconhecido por calendar-view.tsx), só que
 * a origem é o sync automático em vez de a 360 anexando um pedido
 * manualmente. Valor próprio (não reaproveita CLIENT_PORTAL_SOURCE)
 * pra nunca confundir de onde uma linha veio ao investigar depois.
 */
export const FACILIT_SYNC_SOURCE = 'facilit_sync'

/** Duração padrão quando a Facil-IT não informa (raro — visitDate normalmente já vem com hora). */
const DEFAULT_DURATION_MINUTES = 60

function buildAddress(order: MappedFacilitOrder): string | null {
  const parts = [order.address1, order.address2, order.city, order.state, order.zip].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

export type FacilitAppointmentInsertRow = {
  org_id: string
  unit_id: string
  customer_id: string
  employee_id: null
  starts_at: string
  ends_at: string
  status: 'scheduled'
  source: string
  address: string | null
  notes: string | null
  service_order_requested_date: string
  service_order_number: string | null
  service_order_client_po: string | null
  service_order_priority: string | null
  service_order_order_type: string | null
  service_order_location_name: string | null
  service_order_location_phone: string | null
  service_order_summary_pt: string | null
}

/**
 * Monta o payload de insert em `appointments` pra uma ordem importada
 * da Facil-IT — sempre employee_id NULL (o cliente atribui profissional
 * e confirma o horário pela própria tela de agenda, igual ao Portal
 * 360). Diferente do Portal 360 (que só tem o DIA escolhido, hora é
 * sempre placeholder), a Facil-IT já manda data E hora reais da visita
 * — usa isso direto como starts_at, é informação real, não um
 * placeholder a esconder.
 */
export function buildFacilitAppointmentInsertRow(params: {
  order: MappedFacilitOrder
  customer: { id: string; unitId: string; orgId: string }
  timezone: string
}): FacilitAppointmentInsertRow {
  const { order, customer } = params
  const startsAtDate = order.visit_date ? new Date(order.visit_date) : new Date()
  const startsAt = startsAtDate.toISOString()
  const endsAt = new Date(startsAtDate.getTime() + DEFAULT_DURATION_MINUTES * 60000).toISOString()
  const requestedDate = new Intl.DateTimeFormat('en-CA', { timeZone: params.timezone }).format(startsAtDate)

  return {
    org_id: customer.orgId,
    unit_id: customer.unitId,
    customer_id: customer.id,
    employee_id: null,
    starts_at: startsAt,
    ends_at: endsAt,
    status: 'scheduled',
    source: FACILIT_SYNC_SOURCE,
    address: buildAddress(order),
    notes: order.scope,
    service_order_requested_date: requestedDate,
    service_order_number: order.facilit_order_number,
    service_order_client_po: order.client_po ?? order.po_number,
    service_order_priority: order.priority,
    service_order_order_type: order.order_type,
    service_order_location_name: order.company,
    service_order_location_phone: order.phone,
    service_order_summary_pt: order.scope,
  }
}

export { DEFAULT_CLIENT_COMPANY_NAME as FACILIT_CUSTOMER_COMPANY_NAME }
