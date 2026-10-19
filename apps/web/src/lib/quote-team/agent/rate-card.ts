import type { SupabaseClient } from '@supabase/supabase-js'
import type { RateCardInput } from './commercial'

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/** Regra comercial vigente (SOMENTE service role/admin): a da unidade tem prioridade sobre a da empresa; a mais recente vence. Nada é fixo no código. */
export async function loadActiveRateCard(db: SupabaseClient, job: { org_id: string; unit_id: string }, now = new Date()): Promise<RateCardInput | null> {
  const { data } = await db
    .from('quote_rate_cards')
    .select('*')
    .eq('org_id', job.org_id)
    .eq('is_active', true)
    .is('client_company', null)
    .lte('effective_from', now.toISOString())
    .order('effective_from', { ascending: false })
  const rows = ((data as Record<string, unknown>[] | null) ?? []).filter((r) => (r.effective_to === null || new Date(String(r.effective_to)) > now) && (r.unit_id === null || r.unit_id === job.unit_id))
  rows.sort((a, b) => Number(b.unit_id === job.unit_id) - Number(a.unit_id === job.unit_id))
  const r = rows[0]
  if (!r) return null
  return {
    id: String(r.id),
    billed_hourly_rate: num(r.billed_hourly_rate),
    technician_hourly_pay: num(r.technician_hourly_pay),
    min_billable_hours: num(r.min_billable_hours),
    travel_fee_flat: num(r.travel_fee_flat),
    travel_fee_hourly: num(r.travel_fee_hourly),
    materials_markup_pct: num(r.materials_markup_pct),
    tax_rules: r.tax_rules ?? null,
    rounding_rule: (r.rounding_rule as RateCardInput['rounding_rule']) ?? null,
  }
}
