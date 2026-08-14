import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { handleCandidateInbound } from '@/lib/recruiter/screening-engine'
import { makeCandidate, makeConfig, makeJob, makeUnit } from './fixtures'
import type { JobCandidate } from '@/lib/recruiter/types'

// Pedido do dono (2026-08-14): trava de 40min por intervenção humana
// manual (ver lib/human-intervention.ts) — cobertura equivalente às de
// lib/receptionist/__tests__/engine-guards.test.ts e
// lib/__tests__/human-intervention-lock.test.ts (SDR), agora pro
// Recrutador. Só cobre o caminho suprimido: o guard roda antes de
// qualquer chamada à OpenAI/envio de mensagem (primeira coisa na função),
// então não precisa montar o resto do pipeline pra este teste.

function makeJobCandidate(overrides: Partial<JobCandidate> = {}): JobCandidate {
  return {
    id: 'jc-1',
    job_id: 'job-1',
    candidate_id: 'cand-1',
    unit_id: 'unit-1',
    stage: 'in_screening',
    stage_reason: null,
    ai_score: null,
    match_score: null,
    rank: null,
    score_breakdown: {},
    report: null,
    outreach_attempts: 1,
    contacted_at: new Date().toISOString(),
    screened_at: null,
    presented_at: null,
    smarter_recruiting_added_at: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('handleCandidateInbound — trava de 40min por intervenção humana', () => {
  it('não gera nem envia resposta quando um humano interveio pra este candidato há menos de 40min', async () => {
    const unit = makeUnit()
    const candidate = makeCandidate()
    const job = makeJob()
    const jc = makeJobCandidate()
    const config = makeConfig({ agent_type: 'recruiter' })

    const { supabase, db } = createFakeSupabase({
      system_events: [
        {
          id: 'evt-human-intervention',
          unit_id: unit.id,
          org_id: unit.org_id,
          event_type: 'human_operator_message',
          level: 'info',
          source: 'system',
          message: 'Intervenção humana manual detectada.',
          metadata: { contact_id: candidate.id },
          created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        },
      ],
    })

    await handleCandidateInbound(supabase, {
      job,
      jc,
      candidate,
      unit,
      config,
      lead: null,
      text: 'oi, ainda ta ai?',
    })

    // Nenhuma mensagem/decisão foi registrada — a função voltou logo no guard.
    expect(db.candidate_messages ?? []).toHaveLength(0)
    expect(db.recruiter_decisions ?? []).toHaveLength(0)
  })
})
