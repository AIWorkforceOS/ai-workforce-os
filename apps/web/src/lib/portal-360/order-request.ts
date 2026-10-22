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
  service_order_file_url: string | null
  service_order_file_name: string | null
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
  custom_fields: Record<string, unknown>
}

export type NewOrderFields = {
  requestedDate: string
  description: string | null
  priority: string | null
  locationName: string | null
  address: string | null
  approvedAmount: number | null
  approvedHours: number | null
}

export const ORDER_PRIORITIES = ['Low', 'Medium', 'High', 'Emergency'] as const

const clean = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

function optionalNumber(value: unknown, max: number, label: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return { ok: true, value: null }
  const n = Number(typeof value === 'string' ? value.replace(/[$,\s]/g, '') : value)
  if (!Number.isFinite(n) || n < 0 || n > max) return { ok: false, error: `${label} must be a number between 0 and ${max.toLocaleString('en-US')}.` }
  return { ok: true, value: Math.round(n * 100) / 100 }
}

/** Valida os campos do formulário "New order" do portal (puro). Exige o arquivo OU a descrição escrita. */
export function parseNewOrderFields(get: (key: string) => unknown, todayIsoDate: string, hasFile: boolean): { ok: true; value: NewOrderFields } | { ok: false; error: string } {
  const date = validateRequestedDate(get('requestedDate'), todayIsoDate)
  if (!date.ok) return date
  const description = clean(get('description'), 4000)
  if (!hasFile && !description) return { ok: false, error: 'Attach the service order or write/paste the order description.' }
  const rawPriority = clean(get('priority'), 20)
  if (rawPriority && !(ORDER_PRIORITIES as readonly string[]).includes(rawPriority)) return { ok: false, error: 'Choose a valid priority.' }
  const amount = optionalNumber(get('approvedAmount'), 10_000_000, 'Approved amount')
  if (!amount.ok) return amount
  const hours = optionalNumber(get('approvedHours'), 1000, 'Approved hours')
  if (!hours.ok) return hours
  return { ok: true, value: { requestedDate: date.date, description, priority: rawPriority, locationName: clean(get('locationName'), 120), address: clean(get('address'), 200), approvedAmount: amount.value, approvedHours: hours.value } }
}

/**
 * Monta o payload de insert em `appointments` para um pedido novo do portal — sempre employee_id NULL (pendente de atribuição, ver migration 061) e
 * source=CLIENT_PORTAL_SOURCE, o par que o admin usa para reconhecer a linha no calendário. Função pura: quem chama já resolveu o customer/unit alvo
 * e subiu os arquivos. O texto escrito pelo cliente vira o escopo (em inglês) quando não há documento que o forneça; o que o cliente informou
 * (descrição, valor e horas aprovados, fotos) fica em custom_fields.client_request para o escritório ver.
 */
export function buildClientOrderInsertRow(params: {
  customer: { id: string; unitId: string; orgId: string }
  fields: NewOrderFields
  timezone: string
  file: { url: string; name: string } | null
  photoUrls: string[]
  extraction: ServiceOrderExtraction | null
}): ClientOrderInsertRow {
  const { customer, fields, timezone, file, photoUrls, extraction } = params
  const { startsAt, endsAt } = buildPlaceholderTimeRange(fields.requestedDate, timezone)
  return {
    org_id: customer.orgId,
    unit_id: customer.unitId,
    customer_id: customer.id,
    employee_id: null,
    starts_at: startsAt,
    ends_at: endsAt,
    status: 'scheduled',
    source: CLIENT_PORTAL_SOURCE,
    address: fields.address ?? extraction?.address ?? null,
    service_order_requested_date: fields.requestedDate,
    service_order_file_url: file?.url ?? null,
    service_order_file_name: file?.name ?? null,
    service_order_number: extraction?.orderNumber ?? null,
    service_order_summary_pt: extraction?.summaryPt ?? null,
    service_order_scope_en: extraction?.scopeEn ?? fields.description,
    service_order_client_po: extraction?.clientPo ?? null,
    service_order_priority: fields.priority ?? extraction?.priority ?? null,
    service_order_order_type: extraction?.orderType ?? null,
    service_order_ivr_pin: extraction?.ivrPin ?? null,
    service_order_location_name: fields.locationName ?? extraction?.locationName ?? null,
    service_order_location_phone: extraction?.locationPhone ?? null,
    service_order_issuer_name: extraction?.issuerName ?? null,
    service_order_issuer_email: extraction?.issuerEmail ?? null,
    custom_fields: { client_request: { description: fields.description, approvedAmount: fields.approvedAmount, approvedHours: fields.approvedHours, photos: photoUrls } },
  }
}
