import { zonedTimeToUtc } from '@/lib/slot-engine'
import type { ServiceOrderExtraction } from '@/lib/service-orders/extraction'

/**
 * Uma ordem do lote já processada pela extração por IA (ou não, se a
 * extração falhou) — o admin ainda precisa escolher manualmente o
 * profissional e o horário antes de virar agendamento. Ver
 * bulk-service-order-import-modal.tsx.
 */
export type BulkOrderRow = {
  id: string
  fileName: string
  fileUrl: string
  extractionFailed: boolean
  orderNumber: string
  summaryPt: string
  scopeEn: string
  address: string
  clientPo: string
  priority: string
  orderType: string
  ivrPin: string
  locationName: string
  locationPhone: string
  issuerName: string
  issuerEmail: string
  employeeId: string
  time: string
}

/**
 * Constrói uma linha da tabela de importação a partir do resultado da
 * extração por IA — nunca lança e nunca bloqueia: se `extraction` for
 * null (upload falhou, arquivo ilegível, sem API key configurada) a
 * linha ainda existe, com os campos em branco pra preenchimento manual.
 */
export function extractionToRow(
  id: string,
  fileName: string,
  fileUrl: string,
  extraction: (ServiceOrderExtraction & { failed?: boolean }) | null
): BulkOrderRow {
  return {
    id,
    fileName,
    fileUrl,
    extractionFailed: !extraction || extraction.failed === true,
    orderNumber: extraction?.orderNumber ?? '',
    summaryPt: extraction?.summaryPt ?? '',
    scopeEn: extraction?.scopeEn ?? '',
    address: extraction?.address ?? '',
    clientPo: extraction?.clientPo ?? '',
    priority: extraction?.priority ?? '',
    orderType: extraction?.orderType ?? '',
    ivrPin: extraction?.ivrPin ?? '',
    locationName: extraction?.locationName ?? '',
    locationPhone: extraction?.locationPhone ?? '',
    issuerName: extraction?.issuerName ?? '',
    issuerEmail: extraction?.issuerEmail ?? '',
    employeeId: '',
    time: '',
  }
}

/**
 * Nome de cadastro do cliente pra uma linha do lote. Nesse fluxo o
 * "cliente" é a loja/local do atendimento (ordem da contratante), não
 * alguém que liga pedindo serviço — por isso a identidade vem do local
 * extraído, nunca fica em branco (cai pro número da ordem e por fim pro
 * nome do arquivo).
 */
export function customerNameForRow(row: BulkOrderRow): string {
  return row.locationName.trim() || (row.orderNumber.trim() ? `Ordem ${row.orderNumber.trim()}` : '') || row.fileName
}

export type BulkRowValidationError = { rowId: string; message: string }

/** Cada linha que vai virar agendamento precisa de profissional e horário escolhidos manualmente pelo admin. */
export function validateRowsForCreate(rows: BulkOrderRow[]): BulkRowValidationError[] {
  const errors: BulkRowValidationError[] = []
  for (const row of rows) {
    if (!row.employeeId) errors.push({ rowId: row.id, message: `${row.fileName}: escolha o profissional.` })
    if (!row.time) errors.push({ rowId: row.id, message: `${row.fileName}: escolha o horário.` })
  }
  return errors
}

export type BulkAppointmentInsertRow = {
  org_id: string
  unit_id: string
  customer_id: string
  service_id: string | null
  employee_id: string
  starts_at: string
  ends_at: string
  address: string | null
  source: string
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
 * Monta o payload de insert em lote pra `appointments` — cada linha da
 * tabela vira um agendamento completo, reaproveitando o mesmo formato
 * de campos `service_order_*` já usado no anexo único
 * (AppointmentFormModal/ServiceOrderAttachModal). Função pura: não toca
 * Supabase — quem chama já resolveu `customerIdByRowId` (cadastro do
 * cliente/local) antes de montar e inserir este payload.
 */
export function buildBulkAppointmentInsertRows(params: {
  rows: BulkOrderRow[]
  customerIdByRowId: Record<string, string>
  date: string
  timezone: string
  durationMinutes: number
  orgId: string
  unitId: string
  serviceId: string | null
}): BulkAppointmentInsertRow[] {
  const { rows, customerIdByRowId, date, timezone, durationMinutes, orgId, unitId, serviceId } = params
  return rows.map((row) => {
    const customerId = customerIdByRowId[row.id]
    if (!customerId) {
      throw new Error(`Sem cliente resolvido para a linha ${row.fileName}.`)
    }
    const startsAt = zonedTimeToUtc(date, row.time, timezone)
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000)
    return {
      org_id: orgId,
      unit_id: unitId,
      customer_id: customerId,
      service_id: serviceId,
      employee_id: row.employeeId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      address: row.address.trim() || null,
      source: 'service_order_bulk_import',
      service_order_file_url: row.fileUrl,
      service_order_file_name: row.fileName,
      service_order_number: row.orderNumber.trim() || null,
      service_order_summary_pt: row.summaryPt.trim() || null,
      service_order_scope_en: row.scopeEn.trim() || null,
      service_order_client_po: row.clientPo.trim() || null,
      service_order_priority: row.priority.trim() || null,
      service_order_order_type: row.orderType.trim() || null,
      service_order_ivr_pin: row.ivrPin.trim() || null,
      service_order_location_name: row.locationName.trim() || null,
      service_order_location_phone: row.locationPhone.trim() || null,
      service_order_issuer_name: row.issuerName.trim() || null,
      service_order_issuer_email: row.issuerEmail.trim() || null,
    }
  })
}
