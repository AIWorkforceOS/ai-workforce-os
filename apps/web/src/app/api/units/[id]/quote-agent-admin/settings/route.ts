import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUnitAdmin } from '@/lib/quote-team/agent/admin-guard'

export const dynamic = 'force-dynamic'

const schema = z.object({
  mode: z.enum(['off', 'shadow', 'live']).optional(),
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
  const { db, unit } = guard.ctx

  if (parsed.data.mode) {
    const { error } = await db.from('units').update({ quote_ai_team_mode: parsed.data.mode }).eq('id', unit.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }
  for (const e of parsed.data.employees ?? []) {
    // só funcionários DESTA unidade
    await db.from('employees').update({ quote_agent_enabled: e.enabled }).eq('id', e.id).eq('unit_id', unit.id)
  }
  const { data: emps } = await db.from('employees').select('id, name, quote_agent_enabled').eq('unit_id', unit.id)
  return NextResponse.json({ mode: parsed.data.mode ?? unit.quote_ai_team_mode, employees: emps })
}
