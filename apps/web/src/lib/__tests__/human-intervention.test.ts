import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from './fake-supabase'
import {
  HUMAN_OPERATOR_MESSAGE_EVENT_TYPE,
  HUMAN_INTERVENTION_RELEASED_EVENT_TYPE,
  isHumanInterventionActive,
  recordHumanIntervention,
  releaseHumanIntervention,
} from '@/lib/human-intervention'
import type { Unit } from '@/lib/types'

// Cobre o botão novo "Devolver à automação" da Caixa de Entrada
// (docs/ux-audit-fase1-2026-08-19.md, Fase 4): antes só existia a trava
// implícita de 40min (recordHumanIntervention); agora um operador pode
// destravar antes do prazo, e isHumanInterventionActive precisa respeitar
// qual dos dois eventos é o mais recente.

function buildUnit(overrides: Partial<Unit> = {}): Unit {
  return { id: 'unit-1', org_id: 'org-1', name: 'Matriz', ...overrides } as Unit
}

describe('human-intervention: trava e destrava', () => {
  it('sem nenhum evento, não está travado', async () => {
    const { supabase } = createFakeSupabase()
    const active = await isHumanInterventionActive(supabase, { unitId: 'unit-1', contactId: 'lead-1' })
    expect(active).toBe(false)
  })

  it('depois de recordHumanIntervention, fica travado', async () => {
    const { supabase } = createFakeSupabase()
    await recordHumanIntervention(supabase, { unit: buildUnit(), contactId: 'lead-1' })
    const active = await isHumanInterventionActive(supabase, { unitId: 'unit-1', contactId: 'lead-1' })
    expect(active).toBe(true)
  })

  // Seeda o banco falso direto com created_at explícito e espaçado, em vez
  // de encadear chamadas reais (que caem no mesmo milissegundo em execução
  // síncrona de teste e tornam o resultado do empate indeterminado — o
  // mesmo ponto cego que hasRecentEventForContact já tem em produção,
  // system_events não tem coluna sequencial pra desempate. Ver comentário
  // em latestInterventionEventType em human-intervention.ts.).
  function seedEvent(db: ReturnType<typeof createFakeSupabase>['db'], eventType: string, offsetMs: number) {
    db.system_events = db.system_events ?? []
    db.system_events.push({
      id: `evt-${db.system_events.length + 1}`,
      unit_id: 'unit-1',
      event_type: eventType,
      metadata: { contact_id: 'lead-1' },
      created_at: new Date(Date.now() + offsetMs).toISOString(),
    })
  }

  it('releaseHumanIntervention depois da trava destrava imediatamente', async () => {
    const { supabase, db } = createFakeSupabase()
    seedEvent(db, HUMAN_OPERATOR_MESSAGE_EVENT_TYPE, 0)
    seedEvent(db, HUMAN_INTERVENTION_RELEASED_EVENT_TYPE, 1000)
    const active = await isHumanInterventionActive(supabase, { unitId: 'unit-1', contactId: 'lead-1' })
    expect(active).toBe(false)
  })

  it('uma nova intervenção depois do release trava de novo (o mais recente vence)', async () => {
    const { supabase, db } = createFakeSupabase()
    seedEvent(db, HUMAN_OPERATOR_MESSAGE_EVENT_TYPE, 0)
    seedEvent(db, HUMAN_INTERVENTION_RELEASED_EVENT_TYPE, 1000)
    seedEvent(db, HUMAN_OPERATOR_MESSAGE_EVENT_TYPE, 2000)
    const active = await isHumanInterventionActive(supabase, { unitId: 'unit-1', contactId: 'lead-1' })
    expect(active).toBe(true)
  })

  it('não mistura contatos ou unidades diferentes', async () => {
    const { supabase } = createFakeSupabase()
    await recordHumanIntervention(supabase, { unit: buildUnit(), contactId: 'lead-1' })

    expect(await isHumanInterventionActive(supabase, { unitId: 'unit-1', contactId: 'lead-2' })).toBe(false)
    expect(await isHumanInterventionActive(supabase, { unitId: 'unit-2', contactId: 'lead-1' })).toBe(false)
  })

  it('grava event_type e metadata corretos pra cada ação', async () => {
    const { supabase, db } = createFakeSupabase()
    await recordHumanIntervention(supabase, { unit: buildUnit(), contactId: 'lead-1' })
    await releaseHumanIntervention(supabase, { unit: buildUnit(), contactId: 'lead-1' })

    const events = db.system_events as { event_type: string; metadata: { contact_id: string } }[]
    expect(events.map((e) => e.event_type)).toEqual([
      HUMAN_OPERATOR_MESSAGE_EVENT_TYPE,
      HUMAN_INTERVENTION_RELEASED_EVENT_TYPE,
    ])
    expect(events.every((e) => e.metadata.contact_id === 'lead-1')).toBe(true)
  })
})
