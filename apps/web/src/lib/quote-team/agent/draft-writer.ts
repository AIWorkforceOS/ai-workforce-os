import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuditResult, Diagnosis } from '../contracts'
import type { QuoteJobRow } from '../job-store'
import type { AgentSnapshot } from './context'
import { diagnosisFromSteps } from './context'
import type { CostingStageResult } from './costing'
import { materialsTotalFromPricing } from './costing'
import type { LaborStageResult } from './labor'
import type { MaterialsStageResult } from './materials'
import type { PricingStageResult } from './pricing'

const toMicros = (usd: number) => Math.round(usd * 1_000_000)

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error || res.data === null) throw new Error(`${what}: ${res.error?.message ?? 'sem retorno'}`)
  return res.data
}

/**
 * Grava a cotação como uma NOVA VERSÃO (v1, v2…): o que a IA produziu fica em `ai_original` (nunca editado) e nas colunas editáveis;
 * versões anteriores ainda em rascunho viram "superseded" (histórico preservado, imutáveis). Versão APROVADA nunca é tocada.
 * O que for comercial (tarifas, custos, margem) vai SOMENTE para `quote_commercial` (admin) — nunca para as tabelas técnicas.
 */
export async function persistDraftFromJob(db: SupabaseClient, job: QuoteJobRow): Promise<{ draftId: string; version: number }> {
  const steps = job.step_results
  const snapshot = job.input_snapshot as AgentSnapshot
  const diagnosis: Diagnosis | null = diagnosisFromSteps(steps)
  const materials = steps.materials as MaterialsStageResult | { skipped: string } | undefined
  const pricing = steps.pricing as PricingStageResult | undefined
  const labor = steps.labor as LaborStageResult | { skipped: string } | undefined
  const costing = steps.costing as CostingStageResult | undefined
  const audit = steps.audit as AuditResult | undefined
  const items = materials && 'items' in materials ? materials.items : []

  const { data: last } = await db.from('quote_drafts').select('version').eq('appointment_id', job.appointment_id).order('version', { ascending: false }).limit(1).maybeSingle()
  const version = ((last as { version?: number } | null)?.version ?? 0) + 1

  // versões anteriores ainda em rascunho viram histórico (a aprovada nunca é alterada)
  await db.from('quote_drafts').update({ status: 'superseded' }).eq('appointment_id', job.appointment_id).eq('status', 'draft')

  const totals = materialsTotalFromPricing(materials && 'items' in materials ? materials : undefined, pricing)
  const pendingPrices = pricing ? pricing.items.filter((i) => i.status !== 'verified').length : items.filter((i) => i.kind !== 'tool').length
  const warnings = [
    ...(diagnosisWarnings(steps) ?? []),
    ...job.pending_items.map((p) => p.message_pt),
  ]

  const aiOriginal = { diagnosis, materials: materials && 'items' in materials ? materials : null, pricing: pricing ?? null, labor: labor && 'labor' in labor ? labor : null, audit: audit ?? null, round: job.rounds }

  const draft = must(
    await db
      .from('quote_drafts')
      .insert({
        org_id: job.org_id,
        unit_id: job.unit_id,
        appointment_id: job.appointment_id,
        job_id: job.id,
        version,
        status: 'draft',
        technical_check: audit?.status ?? 'needs_confirmation',
        diagnosis,
        photo_exception_reason: job.photo_exception_reason,
        client_text_en: diagnosis ? `${diagnosis.problem_en}\n\n${diagnosis.scope_en}` : null,
        tech_text_pt: diagnosis ? diagnosis.summary_pt : null,
        warnings,
        ai_original: aiOriginal,
        materials_total_micros: totals.micros,
        materials_verified_micros: totals.micros,
        materials_estimated_micros: 0,
        pending_price_count: pendingPrices,
        created_by: job.created_by,
      })
      .select('id')
      .single(),
    'rascunho',
  ) as { id: string }

  try {
    if (items.length > 0) {
      const rows = items.map((item, index) => {
        const priced = pricing?.items.find((p) => p.index === index)
        const option = priced && priced.selected !== null ? priced.options[priced.selected] : null
        const unitMicros = option && option.price != null ? toMicros(option.price) : null
        return {
          draft_id: draft.id,
          org_id: job.org_id,
          unit_id: job.unit_id,
          appointment_id: job.appointment_id,
          position: index,
          kind: item.kind,
          necessity: item.necessity,
          name_en: item.name_en,
          description_pt: item.description_pt,
          quantity: item.quantity,
          unit: item.unit,
          brand: item.brand ?? null,
          model: item.model ?? null,
          part_number: item.part_number ?? null,
          dimensions: item.dimensions ?? null,
          specs: item.specs ?? null,
          compatibility: item.compatibility ?? null,
          reason: item.reason,
          confidence: item.confidence,
          needs_confirmation: item.needs_confirmation ?? null,
          waste_pct: item.waste_pct ?? null,
          waste_justification: item.waste_justification ?? null,
          billable: item.kind !== 'tool',
          price_status: unitMicros !== null ? 'verified' : 'pending',
          unit_price_micros: unitMicros,
          original_unit_price_micros: unitMicros,
          supplier: option?.supplier ?? null,
          product_url: option?.product_url ?? null,
          price_source: unitMicros !== null ? 'ai_verified' : null,
          price_checked_at: unitMicros !== null ? priced?.checked_at ?? null : null,
          ai_original: item,
        }
      })
      const inserted = must(await db.from('quote_items').insert(rows).select('id, position'), 'itens') as { id: string; position: number }[]
      const idByPos = new Map(inserted.map((r) => [r.position, r.id]))
      const optionRows = (pricing?.items ?? []).flatMap((p) =>
        p.options.map((o, oi) => ({
          item_id: idByPos.get(p.index) as string,
          draft_id: draft.id,
          org_id: job.org_id,
          unit_id: job.unit_id,
          appointment_id: job.appointment_id,
          supplier: o.supplier,
          product_url: o.product_url,
          title: o.title,
          brand: o.brand,
          model: o.model,
          sku: o.sku,
          price_micros: o.price != null ? toMicros(o.price) : null,
          currency: 'USD',
          retrieved_at: p.checked_at,
          evidence: { snippet: o.snippet, reason: o.reason, compatibility_note: o.compatibility_note },
          link_check: { result: 'not_checked' },
          stock_verified: false,
          match_score: o.match_score,
          is_selected: p.selected === oi,
          from_cache: false,
        })),
      ).filter((r) => r.item_id)
      if (optionRows.length > 0) must(await db.from('quote_item_options').insert(optionRows).select('id'), 'opções de produto')
    }

    if (labor && 'labor' in labor) {
      must(
        await db
          .from('quote_labor_plan')
          .insert({
            draft_id: draft.id,
            org_id: job.org_id,
            unit_id: job.unit_id,
            appointment_id: job.appointment_id,
            technicians: labor.labor.technicians,
            service_hours: labor.labor.service_hours,
            man_hours: labor.man_hours,
            travel_hours: labor.labor.travel_hours ?? null,
            idle_hours: labor.labor.idle_hours ?? null,
            multi_technician_justification: labor.labor.multi_technician_justification ?? null,
            justification_pt: labor.labor.justification_pt,
            description_en: labor.labor.description_en,
            breakdown: labor.labor.breakdown,
          })
          .select('id')
          .single(),
        'mão de obra',
      )
    }

    const mediaUrls = [...new Set(snapshot.media_urls ?? [])]
    if (mediaUrls.length > 0) {
      must(
        await db
          .from('quote_draft_media')
          .insert(mediaUrls.map((url, position) => ({ draft_id: draft.id, org_id: job.org_id, unit_id: job.unit_id, appointment_id: job.appointment_id, media_url: url, role: 'photo', position })))
          .select('id'),
        'mídias',
      )
    }

    if (costing && !costing.skipped) {
      const c = costing.commercial
      must(
        await db
          .from('quote_commercial')
          .insert({
            draft_id: draft.id,
            org_id: job.org_id,
            unit_id: job.unit_id,
            appointment_id: job.appointment_id,
            rate_card_id: c.rate_card_id,
            rate_card_snapshot: costing.rate_card,
            billed_labor_micros: c.billed_labor_micros,
            internal_labor_cost_micros: c.internal_labor_cost_micros,
            materials_markup_micros: c.materials_markup_micros,
            taxes_micros: c.taxes_micros,
            commercial_total_micros: c.commercial_total_micros,
            margin_micros: c.margin_micros,
            notes: c.notes.join(' | ') || null,
            computed_at: new Date().toISOString(),
          })
          .select('id')
          .single(),
        'camada comercial',
      )
    }

    await db.from('quote_events').insert([
      { org_id: job.org_id, unit_id: job.unit_id, appointment_id: job.appointment_id, draft_id: draft.id, job_id: job.id, actor_role: 'system', type: 'draft_created', diff: { version, technical_check: audit?.status ?? null, round: job.rounds }, visibility: 'technician' },
      { org_id: job.org_id, unit_id: job.unit_id, appointment_id: job.appointment_id, draft_id: draft.id, job_id: job.id, actor_role: 'system', type: 'ai_cost', diff: { spent_usd: job.spent_usd, unconfirmed_usd: job.unconfirmed_usd, ai_calls: job.ai_calls }, visibility: 'admin' },
    ])
  } catch (error) {
    // não deixa uma versão pela metade: apaga o rascunho (cascata) e o job fica retomável
    await db.from('quote_drafts').delete().eq('id', draft.id)
    throw error
  }
  return { draftId: draft.id, version }
}

function diagnosisWarnings(steps: Record<string, unknown>): string[] | null {
  const d = steps.diagnosis as { warnings?: string[] } | undefined
  const m = steps.materials as { warnings?: string[] } | undefined
  const l = steps.labor as { warnings?: string[] } | undefined
  return [...(d?.warnings ?? []), ...(m?.warnings ?? []), ...(l?.warnings ?? [])]
}
