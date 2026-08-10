import { zonedTimeToUtc } from '@/lib/slot-engine'
import { CLIENT_PORTAL_SOURCE } from '@/lib/portal-360/constants'
import type { ServiceOrderExtraction } from '@/lib/service-orders/extraction'

/**
 * Validação (pura, sem I/O) do dia escolhido pela 360 ao anexar uma
 * ordem pelo Portal 360 — só o DIA, nunca hora/profissional (isso
 * continua 100% com o admin da Mawi, ver migration 061). Usada pela
 * rota POST /api/portal-360/orders antes de subir qualquer arquivo.
 */
export type RequestedDateValidation = { ok: true; date: string } | { ok: false; error: string }

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/

export function validateRequestedDate(value: unknown, todayIsoDate: string): RequestedDateValidation {
  if (typeof value !== 'string' || !DATE_FORMAT.test(value)) {
    return { ok: false, error: 'Choose a valid date.' }
  }
  // Comparação lexicográfica é segura para 'YYYY-MM-DD' (mesmo formato, mesmo comprimento).
  if (value < todayIsoDate) {
    return { ok: false, error: 'The requested date cannot be in the past.' }
  }
  return { ok: true, date: value }
}

/**
 * appointments.starts_at/ends_at são NOT NULL (constraint ends_at >
 * starts_at) — sem hora real escolhida ainda, este horário é só um
 * placeholder (meio-dia local, 1h de duração) para a linha existir e
 * aparecer no dia certo do calendário do admin. Nunca deve ser
 * mostrado como um compromisso real na UI — use
 * service_order_requested_date para isso.
 */
const PLACEHOLDER_TIME = '12:00'
const PLACEHOLDER_DURATION_MINUTES = 60

export function buildPlaceholderTimeRange(requestedDate: string, timezone: string): { startsAt: string; endsAt: string } {
  const startsAt = zonedTimeToUtc(requestedDate, PLACEHOLDER_TIME, timezone)
  const endsAt = new Date(startsAt.getTime() + PLACEHOLDER_DURATION_MINUTES * 60000)
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
}

export type ClientOrderInsertRow = {
  org_id: string
  unit_id: string
  customer_id: string
  employee_id: null
  starts_at: string
  ends_at: string
  status: 'scheduled'
  source: string
  address: string | null
  service_order_requested_date: string
  service_order_file_url: string
  service_order_file_name: string
  service_order_number: string | null
  service_order_summary_pt: string | null
  service_order_scope_en: string | null
  service_order_client_po: string | null
  service_order_priority: string | null
  service_order_order_type: string | null
  service_order_ivr_pin: string | null
  service_order_location_name: string | null
  service_order_location_phone: string | null
  service_order_issuer_name: string | null
  service_order_issuer_email: string | null
}

/**
 * Monta o payload de insert em `appointments` para um pedido novo da
 * 360 — sempre employee_id NULL (pendente de atribuição, ver
 * migration 061) e source=CLIENT_PORTAL_SOURCE, o par que o admin usa
 * para reconhecer a linha no calendário. Função pura: quem chama já
 * resolveu o customer/unit alvo (ver resolveClientTargetCustomer em
 * lib/portal-360/data.ts) e subiu o arquivo original.
 */
export function buildClientOrderInsertRow(params: {
  customer: { id: string; unitId: string; orgId: string }
  requestedDate: string
  timezone: string
  fileUrl: string
  fileName: string
  extraction: ServiceOrderExtraction | null
}): ClientOrderInsertRow {
  const { customer, requestedDate, timezone, fileUrl, fileName, extraction } = params
  const { startsAt, endsAt } = buildPlaceholderTimeRange(requestedDate, timezone)
  return {
    org_id: customer.orgId,
    unit_id: customer.unitId,
    customer_id: customer.id,
    employee_id: null,
    starts_at: startsAt,
    ends_at: endsAt,
    status: 'scheduled',
    source: CLIENT_PORTAL_SOURCE,
    address: extraction?.address ?? null,
    service_order_requested_date: requestedDate,
    service_order_file_url: fileUrl,
    service_order_file_name: fileName,
    service_order_number: extraction?.orderNumber ?? null,
    service_order_summary_pt: extraction?.summaryPt ?? null,
    service_order_scope_en: extraction?.scopeEn ?? null,
    service_order_client_po: extraction?.clientPo ?? null,
    service_order_priority: extraction?.priority ?? null,
    service_order_order_type: extraction?.orderType ?? null,
    service_order_ivr_pin: extraction?.ivrPin ?? null,
    service_order_location_name: extraction?.locationName ?? null,
    service_order_location_phone: extraction?.locationPhone ?? null,
    service_order_issuer_name: extraction?.issuerName ?? null,
    service_order_issuer_email: extraction?.issuerEmail ?? null,
  }
}
