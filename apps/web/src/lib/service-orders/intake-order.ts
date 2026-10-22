import { zonedTimeToUtc } from '@/lib/slot-engine'
import type { OrderAnalysis } from './demand-analysis'

/** Ordem anexada pelo administrador (PDF e/ou descrição, fotos e cliente), ainda sem técnico — entra na Agenda como "sem técnico atribuído". */
export const ADMIN_INTAKE_SOURCE = 'admin_intake'

export type IntakeForm = {
  clientName: string
  date: string // YYYY-MM-DD
  description: string
  fileUrl: string
  fileName: string
  photoUrls: string[]
  orderNumber: string
  clientPo: string
  priority: string
  orderType: string
  locationName: string
  locationPhone: string
  address: string
  scopeEn: string
  summaryPt: string
  ivrPin: string
  issuerName: string
  issuerEmail: string
  analysis: OrderAnalysis | null
}

export function emptyIntakeForm(date: string): IntakeForm {
  return { clientName: '', date, description: '', fileUrl: '', fileName: '', photoUrls: [], orderNumber: '', clientPo: '', priority: '', orderType: '', locationName: '', locationPhone: '', address: '', scopeEn: '', summaryPt: '', ivrPin: '', issuerName: '', issuerEmail: '', analysis: null }
}

export function validateIntake(form: IntakeForm): string | null {
  if (!form.clientName.trim()) return 'Escolha o cliente da ordem.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return 'Informe a data.'
  if (!form.fileUrl && !form.description.trim()) return 'Anexe o PDF/foto da ordem ou cole a descrição.'
  return null
}

const orNull = (v: string) => (v.trim() ? v.trim() : null)

/** Linha de `appointments` da ordem anexada. Sem técnico; 09:00–10:00 do dia escolhido (o administrador define profissional e horário depois). */
export function buildIntakeAppointmentRow(args: { orgId: string; unitId: string; customerId: string; timezone: string; form: IntakeForm; now?: Date }) {
  const { form } = args
  const start = zonedTimeToUtc(form.date, '09:00', args.timezone)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  const description = form.description.trim()
  return {
    org_id: args.orgId,
    unit_id: args.unitId,
    customer_id: args.customerId,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    status: 'scheduled' as const,
    source: ADMIN_INTAKE_SOURCE,
    address: orNull(form.address),
    notes: description ? description.slice(0, 500) : null,
    service_order_file_url: orNull(form.fileUrl),
    service_order_file_name: orNull(form.fileName),
    service_order_number: orNull(form.orderNumber),
    service_order_client_po: orNull(form.clientPo),
    service_order_priority: orNull(form.priority),
    service_order_order_type: orNull(form.orderType),
    service_order_location_name: orNull(form.locationName),
    service_order_location_phone: orNull(form.locationPhone),
    service_order_ivr_pin: orNull(form.ivrPin),
    service_order_issuer_name: orNull(form.issuerName),
    service_order_issuer_email: orNull(form.issuerEmail),
    service_order_scope_en: orNull(form.scopeEn),
    service_order_summary_pt: orNull(form.summaryPt) ?? orNull(description),
    custom_fields: {
      ...(form.analysis ? { order_analysis: { ...form.analysis, generated_at: (args.now ?? new Date()).toISOString() } } : {}),
      ...(form.photoUrls.length > 0 ? { reference_photos: form.photoUrls } : {}),
    },
  }
}
