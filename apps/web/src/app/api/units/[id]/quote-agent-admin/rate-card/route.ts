import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUnitAdmin } from '@/lib/quote-team/agent/admin-guard'

export const dynamic = 'force-dynamic'

const money = z.number().nonnegative().max(100000).nullable().optional()
const schema = z.object({
  name: z.string().min(1).max(80).default('Padrão'),
  billed_hourly_rate: money,
  technician_hourly_pay: money,
  min_billable_hours: z.number().nonnegative().max(1000).nullable().optional(),
  travel_fee_flat: money,
  travel_fee_hourly: money,
  materials_markup_pct: z.number().min(0).max(1000).nullable().optional(),
  /** Só imposto percentual simples: { pct }. Qualquer outro formato NÃO é calculado. */
  tax_pct: z.number().min(0).max(100).nullable().optional(),
  rounding_rule: z.enum(['cent_half_up', 'cent_up', 'cent_down', 'dollar_half_up']).nullable().optional(),
})

/** Regra comercial da unidade (SOMENTE ADMIN; tarifas nunca ficam no código nem chegam ao técnico). Cada gravação cria uma NOVA vigência e encerra a anterior. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireUnitAdmin(id)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const { db, unit } = guard.ctx
  const { data } = await db.from('quote_rate_cards').select('*').eq('org_id', unit.org_id).eq('is_active', true).or(`unit_id.eq.${unit.id},unit_id.is.null`).order('effective_from', { ascending: false }).limit(1).maybeSingle()
  return NextResponse.json({ rate_card: data ?? null })
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireUnitAdmin(id)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 })
  const { db, unit, appUser } = guard.ctx
  const v = parsed.data
  const now = new Date().toISOString()
  await db.from('quote_rate_cards').update({ is_active: false, effective_to: now }).eq('org_id', unit.org_id).eq('unit_id', unit.id).eq('is_active', true)
  const { data, error } = await db
    .from('quote_rate_cards')
    .insert({
      org_id: unit.org_id,
      unit_id: unit.id,
      name: v.name,
      billed_hourly_rate: v.billed_hourly_rate ?? null,
      technician_hourly_pay: v.technician_hourly_pay ?? null,
      min_billable_hours: v.min_billable_hours ?? null,
      travel_fee_flat: v.travel_fee_flat ?? null,
      travel_fee_hourly: v.travel_fee_hourly ?? null,
      materials_markup_pct: v.materials_markup_pct ?? null,
      tax_rules: v.tax_pct != null ? { pct: v.tax_pct } : null,
      rounding_rule: v.rounding_rule ?? null,
      effective_from: now,
      created_by: appUser.id,
    })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ rate_card: data })
}
