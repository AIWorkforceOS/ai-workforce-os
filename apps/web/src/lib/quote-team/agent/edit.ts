import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { manHours } from '../contracts'
import { computeCommercial, type RateCardInput } from './commercial'

const nullableText = (max: number) => z.string().max(max).nullable().optional()
const httpsUrl = z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'Somente links https.')

const itemFields = {
  name_en: z.string().min(1).max(200),
  description_pt: nullableText(1000),
  quantity: z.number().positive().max(100000),
  unit: z.string().min(1).max(40),
  brand: nullableText(120),
  model: nullableText(120),
  part_number: nullableText(120),
  dimensions: nullableText(200),
  needs_confirmation: nullableText(500),
  supplier: nullableText(160),
  product_url: httpsUrl.nullable().optional(),
  /** Preço de COMPRA por unidade em USD (o técnico pode ver e editar). null = "preço pendente". */
  unit_price_usd: z.number().nonnegative().max(1_000_000).nullable().optional(),
}

export const draftEditSchema = z.object({
  tech_text_pt: z.string().max(8000).optional(),
  client_text_en: z.string().max(8000).optional(),
  items: z.array(z.object({ id: z.string().uuid() }).extend(Object.fromEntries(Object.entries(itemFields).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof itemFields]: z.ZodOptional<(typeof itemFields)[K]> })).max(60).optional(),
  add_items: z.array(z.object({ ...itemFields, kind: z.enum(['material', 'consumable', 'tool']).optional() })).max(30).optional(),
  remove_item_ids: z.array(z.string().uuid()).max(60).optional(),
  labor: z
    .object({
      technicians: z.number().int().min(1).max(10),
      service_hours: z.number().nonnegative().max(200),
      travel_hours: z.number().nonnegative().max(100).nullable().optional(),
      idle_hours: z.number().nonnegative().max(100).nullable().optional(),
      multi_technician_justification: nullableText(500),
      justification_pt: nullableText(1500),
    })
    .optional(),
})
export type DraftEdit = z.infer<typeof draftEditSchema>

const toMicros = (usd: number) => Math.round(usd * 1_000_000)
type Row = Record<string, unknown>

export class DraftEditError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
  }
}

/** Aplica as edições do técnico/admin numa versão em RASCUNHO. Versão aprovada/histórica nunca é alterada (409). */
export async function applyDraftEdits(db: SupabaseClient, draftId: string, edit: DraftEdit, actor: { id: string; role: 'technician' | 'admin' }): Promise<void> {
  const { data: draftRow } = await db.from('quote_drafts').select('*').eq('id', draftId).maybeSingle()
  const draft = draftRow as Row | null
  if (!draft) throw new DraftEditError('Cotação não encontrada.', 404)
  if (draft.status !== 'draft') throw new DraftEditError('Esta versão já foi aprovada ou substituída: peça uma revisão para gerar uma nova versão.', 409)

  const { data: existingItems } = await db.from('quote_items').select('*').eq('draft_id', draftId)
  const byId = new Map(((existingItems as Row[] | null) ?? []).map((i) => [String(i.id), i]))
  const edited = new Set<string>(Array.isArray(draft.edited_fields) ? (draft.edited_fields as string[]) : [])
  const now = new Date().toISOString()

  for (const patch of edit.items ?? []) {
    const current = byId.get(patch.id)
    if (!current) throw new DraftEditError('Item não pertence a esta cotação.', 400)
    const update: Row = {}
    for (const key of ['name_en', 'description_pt', 'quantity', 'unit', 'brand', 'model', 'part_number', 'dimensions', 'needs_confirmation', 'supplier', 'product_url'] as const) {
      if (patch[key] !== undefined) update[key] = patch[key]
    }
    if (patch.unit_price_usd !== undefined) {
      if (patch.unit_price_usd === null) Object.assign(update, { unit_price_micros: null, price_status: 'pending', price_source: null, price_checked_at: null })
      else {
        const micros = toMicros(patch.unit_price_usd)
        const sameAsAi = current.original_unit_price_micros === micros && current.price_source === 'ai_verified'
        Object.assign(update, sameAsAi ? { unit_price_micros: micros } : { unit_price_micros: micros, price_status: 'technician_corrected', price_source: 'manual', price_checked_at: now })
      }
    }
    if (Object.keys(update).length === 0) continue
    update.edited_by_technician = true
    const { error } = await db.from('quote_items').update(update).eq('id', patch.id).eq('draft_id', draftId)
    if (error) throw new DraftEditError(error.message)
    edited.add('items')
  }

  for (const id of edit.remove_item_ids ?? []) {
    if (!byId.has(id)) throw new DraftEditError('Item não pertence a esta cotação.', 400)
    const { error } = await db.from('quote_items').delete().eq('id', id).eq('draft_id', draftId)
    if (error) throw new DraftEditError(error.message)
    edited.add('items')
  }

  if ((edit.add_items ?? []).length > 0) {
    const position0 = Math.max(-1, ...[...byId.values()].map((i) => Number(i.position ?? 0))) + 1
    const rows = (edit.add_items ?? []).map((item, i) => {
      const hasPrice = item.unit_price_usd !== undefined && item.unit_price_usd !== null
      return {
        draft_id: draftId,
        org_id: draft.org_id,
        unit_id: draft.unit_id,
        appointment_id: draft.appointment_id,
        position: position0 + i,
        kind: item.kind ?? 'material',
        necessity: 'required',
        name_en: item.name_en,
        description_pt: item.description_pt ?? null,
        quantity: item.quantity,
        unit: item.unit,
        brand: item.brand ?? null,
        model: item.model ?? null,
        part_number: item.part_number ?? null,
        dimensions: item.dimensions ?? null,
        needs_confirmation: item.needs_confirmation ?? null,
        billable: (item.kind ?? 'material') !== 'tool',
        supplier: item.supplier ?? null,
        product_url: item.product_url ?? null,
        price_status: hasPrice ? 'technician_corrected' : 'pending',
        unit_price_micros: hasPrice ? toMicros(item.unit_price_usd as number) : null,
        price_source: hasPrice ? 'manual' : null,
        price_checked_at: hasPrice ? now : null,
        edited_by_technician: true,
      }
    })
    const { error } = await db.from('quote_items').insert(rows)
    if (error) throw new DraftEditError(error.message)
    edited.add('items')
  }

  if (edit.labor) {
    const l = edit.labor
    const justification = l.multi_technician_justification?.trim() || null
    if (l.technicians > 1 && !justification) throw new DraftEditError('Dois ou mais técnicos só com justificativa concreta (peso, dimensão, segurança…).')
    const row = {
      draft_id: draftId,
      org_id: draft.org_id,
      unit_id: draft.unit_id,
      appointment_id: draft.appointment_id,
      technicians: l.technicians,
      service_hours: l.service_hours,
      man_hours: manHours(l.technicians, l.service_hours),
      travel_hours: l.travel_hours ?? null,
      idle_hours: l.idle_hours ?? null,
      multi_technician_justification: l.technicians > 1 ? justification : null,
      justification_pt: l.justification_pt ?? null,
      edited_by_technician: true,
    }
    const { error } = await db.from('quote_labor_plan').upsert(row, { onConflict: 'draft_id' })
    if (error) throw new DraftEditError(error.message)
    edited.add('labor')
  }

  const draftUpdate: Row = {}
  if (edit.tech_text_pt !== undefined) {
    draftUpdate.tech_text_pt = edit.tech_text_pt
    edited.add('text')
  }
  if (edit.client_text_en !== undefined) {
    draftUpdate.client_text_en = edit.client_text_en
    edited.add('text')
  }

  // totais de materiais (preço de COMPRA) recalculados a partir dos itens
  const { data: after } = await db.from('quote_items').select('kind, quantity, unit_price_micros, price_status').eq('draft_id', draftId)
  const items = (after as Row[] | null) ?? []
  const billable = items.filter((i) => i.kind !== 'tool')
  const priced = billable.filter((i) => i.unit_price_micros !== null && i.unit_price_micros !== undefined)
  const total = priced.reduce((n, i) => n + Math.round(Number(i.quantity) * Number(i.unit_price_micros)), 0)
  const verified = priced.filter((i) => i.price_status === 'verified').reduce((n, i) => n + Math.round(Number(i.quantity) * Number(i.unit_price_micros)), 0)
  Object.assign(draftUpdate, { materials_total_micros: total, materials_verified_micros: verified, materials_estimated_micros: total - verified, pending_price_count: billable.length - priced.length, edited_fields: [...edited] })
  const { error: draftError } = await db.from('quote_drafts').update(draftUpdate).eq('id', draftId)
  if (draftError) throw new DraftEditError(draftError.message)

  await recomputeCommercial(db, draftId).catch(() => undefined)
  await db.from('quote_events').insert({ org_id: draft.org_id, unit_id: draft.unit_id, appointment_id: draft.appointment_id, draft_id: draftId, job_id: draft.job_id ?? null, actor_id: actor.id, actor_role: actor.role, type: 'edited', diff: { fields: [...edited] }, visibility: 'technician' })
}

/** Camada comercial (SOMENTE admin) acompanha as edições: mesma regra gravada no cálculo original (snapshot), novos totais. */
export async function recomputeCommercial(db: SupabaseClient, draftId: string): Promise<void> {
  const { data: commercial } = await db.from('quote_commercial').select('id, rate_card_snapshot').eq('draft_id', draftId).maybeSingle()
  const c = commercial as { id: string; rate_card_snapshot: RateCardInput | null } | null
  if (!c?.rate_card_snapshot) return
  const [{ data: labor }, { data: draft }] = await Promise.all([db.from('quote_labor_plan').select('man_hours, travel_hours').eq('draft_id', draftId).maybeSingle(), db.from('quote_drafts').select('materials_total_micros, pending_price_count').eq('id', draftId).maybeSingle()])
  const l = labor as { man_hours: number; travel_hours: number | null } | null
  const d = draft as { materials_total_micros: number | null; pending_price_count: number } | null
  if (!l || !d) return
  const result = computeCommercial({ rateCard: c.rate_card_snapshot, manHours: Number(l.man_hours), travelHours: l.travel_hours != null ? Number(l.travel_hours) : null, materialsMicros: Number(d.materials_total_micros ?? 0), materialsPartial: Number(d.pending_price_count) > 0 })
  await db.from('quote_commercial').update({ billed_labor_micros: result.billed_labor_micros, internal_labor_cost_micros: result.internal_labor_cost_micros, materials_markup_micros: result.materials_markup_micros, taxes_micros: result.taxes_micros, commercial_total_micros: result.commercial_total_micros, margin_micros: result.margin_micros, notes: result.notes.join(' | ') || null, computed_at: new Date().toISOString() }).eq('id', c.id)
}
