import type { JobStatus, PendingItem } from './contracts'
import { QUOTE_STAGES } from './config'

/**
 * VISIBILIDADE FINANCEIRA (regra do Vinicius): o técnico vê preço de COMPRA de material e tempo/pessoas;
 * NUNCA vê tarifa cobrada, pagamento ao técnico, custo interno, preço de venda, markup, margem, faturamento nem lucro.
 * Aqui fica a barreira de CÓDIGO (serializadores de lista permitida + detector de vazamento). As barreiras de dados
 * (tabelas separadas + RLS sem policy para funcionário) estão nas migrations 093–096.
 */

/** Chaves que NUNCA podem aparecer numa resposta destinada ao técnico, em qualquer nível. */
export const FORBIDDEN_TECHNICIAN_KEY_PATTERN =
  /(billed|hourly|labor_?(rate|cost|price|billed)|internal_?(labor_?)?cost|technician_?(hourly_?)?pay|pay_?rate|markup|margin|profit|revenue|faturamento|lucro|commercial_?(total|labor|price|cost|margin|snapshot)|quote_?commercial|rate_?card|tax_?(rules|micros)|taxes|sale_?price|selling_?price|labor_?micros|total_?commercial)/i

export class CommercialLeakError extends Error {
  constructor(public readonly path: string) {
    super(`Campo comercial no payload do técnico: ${path}`)
    this.name = 'CommercialLeakError'
  }
}

export function assertNoCommercialFields(value: unknown, path = '$'): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoCommercialFields(item, `${path}[${i}]`))
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_TECHNICIAN_KEY_PATTERN.test(key)) throw new CommercialLeakError(`${path}.${key}`)
    assertNoCommercialFields(child, `${path}.${key}`)
  }
}

/** micro-dólares → "4.00" (SÓ para exibição; o valor guardado e os totais nunca são arredondados por isso). */
export function formatUsdFromMicros(micros: number | null | undefined): string | null {
  if (micros == null) return null
  const negative = micros < 0
  const abs = Math.abs(Math.round(micros))
  const cents = Math.round(abs / 10_000)
  const out = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
  return negative ? `-${out}` : out
}

type Row = Record<string, unknown>
const pick = (row: Row, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => k in row).map((k) => [k, row[k]]))

const DRAFT_KEYS = ['id', 'appointment_id', 'version', 'status', 'technical_check', 'commercial_status', 'diagnosis', 'photo_exception_reason', 'client_text_en', 'tech_text_pt', 'warnings', 'edited_fields', 'materials_total_micros', 'materials_verified_micros', 'materials_estimated_micros', 'pending_price_count', 'approved_at'] as const
const ITEM_KEYS = ['id', 'position', 'kind', 'necessity', 'name_en', 'description_pt', 'quantity', 'unit', 'brand', 'model', 'part_number', 'dimensions', 'specs', 'compatibility', 'reason', 'confidence', 'needs_confirmation', 'waste_pct', 'waste_justification', 'billable', 'price_status', 'unit_price_micros', 'price_currency', 'selected_option_id', 'edited_by_technician'] as const
const OPTION_KEYS = ['id', 'item_id', 'supplier', 'product_url', 'title', 'brand', 'model', 'sku', 'price_micros', 'currency', 'retrieved_at', 'link_check', 'stock_verified', 'match_score', 'is_selected', 'from_cache'] as const
const LABOR_KEYS = ['id', 'technicians', 'service_hours', 'man_hours', 'travel_hours', 'idle_hours', 'multi_technician_justification', 'justification_pt', 'description_en', 'breakdown', 'edited_by_technician'] as const
const MEDIA_KEYS = ['id', 'media_url', 'role', 'position', 'note'] as const

export type TechnicianDraftView = {
  draft: Row
  items: (Row & { unit_price_usd: string | null; subtotal_micros: number | null; subtotal_usd: string | null })[]
  options: Row[]
  labor: Row | null
  media: Row[]
  totals: { materials_micros: number | null; materials_usd: string | null; verified_usd: string | null; estimated_usd: string | null; pending_price_count: number; partial: boolean }
}

/** subtotal = quantidade × preço unitário (arredonda só para micro-dólar inteiro; sem arredondar para centavos). */
export function itemSubtotalMicros(quantity: number, unitPriceMicros: number | null | undefined): number | null {
  if (unitPriceMicros == null) return null
  return Math.round(quantity * unitPriceMicros)
}

export function toTechnicianDraftView(input: { draft: Row; items: Row[]; options: Row[]; labor: Row | null; media: Row[] }): TechnicianDraftView {
  const items = input.items.map((item) => {
    const base = pick(item, ITEM_KEYS)
    const subtotal = itemSubtotalMicros(Number(item.quantity), item.unit_price_micros as number | null)
    return { ...base, unit_price_usd: formatUsdFromMicros(item.unit_price_micros as number | null), subtotal_micros: subtotal, subtotal_usd: formatUsdFromMicros(subtotal) }
  })
  const draft = pick(input.draft, DRAFT_KEYS)
  const pending = Number(input.draft.pending_price_count ?? 0)
  const view: TechnicianDraftView = {
    draft,
    items,
    options: input.options.map((o) => pick(o, OPTION_KEYS)),
    labor: input.labor ? pick(input.labor, LABOR_KEYS) : null,
    media: input.media.map((m) => pick(m, MEDIA_KEYS)),
    totals: {
      materials_micros: (input.draft.materials_total_micros as number | null) ?? null,
      materials_usd: formatUsdFromMicros(input.draft.materials_total_micros as number | null),
      verified_usd: formatUsdFromMicros(input.draft.materials_verified_micros as number | null),
      estimated_usd: formatUsdFromMicros(input.draft.materials_estimated_micros as number | null),
      pending_price_count: pending,
      partial: pending > 0,
    },
  }
  assertNoCommercialFields(view)
  return view
}

type JobRow = {
  id: string
  appointment_id: string
  status: JobStatus
  stage: string
  mode: 'shadow' | 'live'
  pending_items: PendingItem[]
  step_results?: Record<string, unknown>
  error_code?: string | null
  spent_usd?: number
  reserved_usd?: number
  unconfirmed_usd?: number
  budget_usd?: number
  ai_calls?: number
  tokens_in?: number
  tokens_out?: number
  attempt_count?: number
  created_at?: string
  finished_at?: string | null
}

function progressOf(job: JobRow): { done: number; total: number } {
  const done = job.status === 'completed' ? QUOTE_STAGES.length : QUOTE_STAGES.filter((s) => job.step_results && s in job.step_results).length
  return { done, total: QUOTE_STAGES.length }
}

/** Acompanhamento para o TÉCNICO: sem custos de IA, sem tentativas, sem nada interno. */
export function toTechnicianJobStatus(job: JobRow) {
  const view = {
    id: job.id,
    appointment_id: job.appointment_id,
    status: job.status,
    stage: job.stage,
    progress: progressOf(job),
    pending: job.pending_items.map((p) => ({ message_pt: p.message_pt, item_ref: p.item_ref ?? null })),
    can_continue_manually: true,
  }
  assertNoCommercialFields(view)
  return view
}

/** Visão do ADMIN: inclui custos de IA e tentativas. */
export function toAdminJobStatus(job: JobRow) {
  return {
    ...toTechnicianJobStatus(job),
    mode: job.mode,
    error_code: job.error_code ?? null,
    attempts: job.attempt_count ?? 0,
    ai: { calls: job.ai_calls ?? 0, tokens_in: job.tokens_in ?? 0, tokens_out: job.tokens_out ?? 0, spent_usd: job.spent_usd ?? 0, reserved_usd: job.reserved_usd ?? 0, unconfirmed_usd: job.unconfirmed_usd ?? 0, budget_usd: job.budget_usd ?? 0 },
    created_at: job.created_at ?? null,
    finished_at: job.finished_at ?? null,
  }
}
