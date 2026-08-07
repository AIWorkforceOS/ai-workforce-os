import type { PortalServiceOrderPhoto } from '@/lib/portal-funcionario/data'

/**
 * Lógica de negócio (pura, sem I/O) do "finalizar/cotar" ordem de
 * serviço no Portal do Funcionário — usada pela rota de API
 * app/api/units/[id]/appointments/[appointmentId]/service-order/route.ts.
 * Fica separada da rota pra ser testável sem mockar Request/FormData, e
 * porque a lista ALLOWED_EMPLOYEE_UPDATE_COLUMNS espelha (documenta) o
 * que o trigger appointments_guard_employee_write (migrations 056/057)
 * também garante no banco — as duas defesas precisam concordar.
 */

export const SERVICE_ORDER_STATUSES = ['completed', 'quote'] as const
export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number]

export function isServiceOrderStatus(value: unknown): value is ServiceOrderStatus {
  return typeof value === 'string' && (SERVICE_ORDER_STATUSES as readonly string[]).includes(value)
}

/** Mesma lista do trigger appointments_guard_employee_write — colunas que role='employee' pode alterar em appointments via esta rota. */
export const ALLOWED_EMPLOYEE_UPDATE_COLUMNS = [
  'service_order_signed_by',
  'service_order_signed_at',
  'service_order_status',
  'service_order_part_purchase_link',
  'service_order_material_description',
  'service_order_material_value',
  'service_order_hours_needed',
  'service_order_photos',
  'updated_at',
] as const

export type ServiceOrderFinalizeInput = {
  status: unknown
  signedBy: unknown
  partPurchaseLink: unknown
  materialDescription: unknown
  materialValue: unknown
  hoursNeeded: unknown
}

export type ServiceOrderFinalizeResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string }

/** Converte um valor de FormData (sempre string ou null) num número >= 0, ou null se vazio/inválido — campo de estimativa, nunca bloqueia o salvamento. */
function parseOptionalNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/**
 * Valida e monta o payload de UPDATE — só campos da lista acima. Fotos
 * já enviadas (uploadedPhotos) são sempre anexadas ao que já existia
 * (existingPhotos), nunca substituem: cada finalização é incremental.
 */
export function buildServiceOrderUpdatePayload(
  input: ServiceOrderFinalizeInput,
  existingPhotos: PortalServiceOrderPhoto[],
  uploadedPhotos: PortalServiceOrderPhoto[],
): ServiceOrderFinalizeResult {
  if (!isServiceOrderStatus(input.status)) {
    return { ok: false, error: 'Selecione "Finalizado" ou "Cotação".' }
  }

  const signedBy = typeof input.signedBy === 'string' ? input.signedBy.trim() : ''
  if (input.status === 'completed' && !signedBy) {
    return { ok: false, error: 'Informe o nome de quem assinou para finalizar.' }
  }

  const partPurchaseLink = typeof input.partPurchaseLink === 'string' ? input.partPurchaseLink.trim() : ''
  const materialDescription = typeof input.materialDescription === 'string' ? input.materialDescription.trim() : ''
  const materialValue = parseOptionalNonNegativeNumber(input.materialValue)
  const hoursNeeded = parseOptionalNonNegativeNumber(input.hoursNeeded)

  const payload: Record<string, unknown> = {
    service_order_status: input.status,
    service_order_photos: [...existingPhotos, ...uploadedPhotos],
    // Link de compra, material e valor só fazem sentido pra cotação — finalizar limpa qualquer valor anterior.
    service_order_part_purchase_link: input.status === 'quote' ? partPurchaseLink || null : null,
    service_order_material_description: input.status === 'quote' ? materialDescription || null : null,
    service_order_material_value: input.status === 'quote' ? materialValue : null,
    // Horas necessárias é uma estimativa útil nos dois status — nunca é limpo por causa do status.
    service_order_hours_needed: hoursNeeded,
  }
  if (signedBy) {
    payload.service_order_signed_by = signedBy
    payload.service_order_signed_at = new Date().toISOString()
  }

  return { ok: true, payload }
}
