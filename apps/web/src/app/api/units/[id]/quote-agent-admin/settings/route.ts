import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUnitAdmin } from '@/lib/quote-team/agent/admin-guard'

export const dynamic = 'force-dynamic'

const schema = z.object({
  mode: z.enum(['off', 'shadow', 'live']).optional(),
  /** Teto em dólares do lote/mês da empresa (nunca acima do máximo da plataforma: US$ 50). */
  monthly_cap_usd: z.number().min(0).max(50).optional(),
  /** Nº máximo de cotações com IA no lote (null = sem limite de quantidade). */
  max_quotes: z.number().int().min(0).max(1000).nullable().optional(),
  employees: z.array(z.object({ id: z.string().uuid(), enabled: z.boolean() })).max(50).optional(),
})

/**
 * Controle do piloto (SOMENTE ADMIN): liga/desliga o Super Agente da unidade (off = como hoje, imediato e sem tocar na operação normal)
 * e define QUAIS técnicos podem usá-lo. Desligar não apaga nada: cotações e histórico continuam guardados.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireUnitAdmin(id)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  const { db, unit, appUser } = guard.ctx

  if (parsed.data.mode) {
    const { error } = await db.from('units').update({ quote_ai_team_mode: parsed.data.mode }).eq('id', unit.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (parsed.data.mode === 'off') {
      // desligar é imediato: nada em andamento continua gastando; cotações e histórico ficam guardados (pode retomar depois)
      await db.from('quote_analysis_jobs').update({ status: 'cancelled', locked_by: null, locked_until: null, error_code: 'switched_off' }).eq('unit_id', unit.id).in('status', ['queued', 'running', 'needs_input'])
    }
  }
  if (parsed.data.monthly_cap_usd !== undefined || parsed.data.max_quotes !== undefined) {
    const patch: Record<string, unknown> = { org_id: unit.org_id, updated_by: appUser.id }
    if (parsed.data.monthly_cap_usd !== undefined) patch.monthly_cap_usd = parsed.data.monthly_cap_usd
    if (parsed.data.max_quotes !== undefined) patch.pilot_max_quotes = parsed.data.max_quotes
    const { error } = await db.from('quote_org_limits').upsert(patch, { onConflict: 'org_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }
  for (const e of parsed.data.employees ?? []) {
    // só funcionários DESTA unidade
    await db.from('employees').update({ quote_agent_enabled: e.enabled }).eq('id', e.id).eq('unit_id', unit.id)
  }
  const { data: emps } = await db.from('employees').select('id, name, quote_agent_enabled').eq('unit_id', unit.id)
  const { data: limits } = await db.from('quote_org_limits').select('monthly_cap_usd, pilot_max_quotes').eq('org_id', unit.org_id).maybeSingle()
  return NextResponse.json({ mode: parsed.data.mode ?? unit.quote_ai_team_mode, employees: emps, limits })
}
