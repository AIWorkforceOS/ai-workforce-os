import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { cancelJob, escalateJob, finalizeSelection, recalculateShortlist } from '@/lib/recruiter/orchestrator'
import { makeConfig, makeJob, makeUnit } from './fixtures'

// Orquestrador (§4, §7.7, §7.8, §17): máquina de estados da vaga. Cobrimos
// transições válidas (screening → shortlist_ready → candidate_selected →
// handed_off, e cancelamento) e inválidas (status fora da máquina não é
// tocado). presentShortlist/sendRejectionFeedback/buildHandoffHtml
// dependem de OpenAI de verdade (geram texto) — mockados aqui para isolar
// a lógica de transição de estado que é a responsabilidade do orquestrador.

const { presentShortlist, sendRejectionFeedback, buildHandoffHtml } = vi.hoisted(() => ({
  presentShortlist: vi.fn(async () => true),
  sendRejectionFeedback: vi.fn(async () => {}),
  buildHandoffHtml: vi.fn(() => '<html></html>'),
}))

vi.mock('@/lib/recruiter/reporting', () => ({ presentShortlist, sendRejectionFeedback, buildHandoffHtml }))
vi.mock('@/lib/email', () => ({ sendRecruiterEmail: vi.fn(async () => ({ ok: true })) }))

beforeEach(() => {
  presentShortlist.mockClear()
  sendRejectionFeedback.mockClear()
  buildHandoffHtml.mockClear()
})

function seedScreenedCandidate(
  overrides: { id: string; ai_score: number; stage?: string } & Record<string, unknown>,
) {
  return {
    id: overrides.id,
    job_id: 'job-1',
    candidate_id: `${overrides.id}-candidate`,
    unit_id: 'unit-1',
    stage: overrides.stage ?? 'screened',
    stage_reason: null,
    ai_score: overrides.ai_score,
    match_score: overrides.ai_score,
    rank: 1,
    score_breakdown: {},
    report: { summary: 'ok', strengths: [], weaknesses: [], score: overrides.ai_score, compatibility_pct: overrides.ai_score, risk: 'baixo', risk_reason: '', availability: '', expectations: '' },
    outreach_attempts: 1,
    contacted_at: null,
    screened_at: null,
    presented_at: null,
    smarter_recruiting_added_at: null,
    created_at: '',
    updated_at: '',
  }
}

describe('recalculateShortlist — máquina de estados da vaga', () => {
  it('não faz nada quando o status da vaga está fora dos estados esperados (transição inválida)', async () => {
    const job = makeJob({ status: 'draft' })
    const unit = makeUnit()
    const config = makeConfig()
    const { supabase, db } = createFakeSupabase({
      job_candidates: [
        { ...seedScreenedCandidate({ id: 'jc-1', ai_score: 90 }) },
      ],
      candidates: [{ id: 'jc-1-candidate', org_id: 'org-1', name: 'Ana' }],
    })

    await recalculateShortlist(supabase, { job, unit, config })

    expect(db.job_candidates![0]!.stage).toBe('screened')
    expect(db.job_openings ?? []).toHaveLength(0)
    expect(presentShortlist).not.toHaveBeenCalled()
  })

  it('reprova (com motivo) candidatos triados abaixo do corte de qualidade e não os leva à shortlist', async () => {
    const job = makeJob({ status: 'outreach', target_shortlist_size: 5 })
    const unit = makeUnit()
    const config = makeConfig() // default screening_score_cutoff = 60
    const { supabase, db } = createFakeSupabase({
      job_candidates: [seedScreenedCandidate({ id: 'jc-low', ai_score: 40 })],
      candidates: [{ id: 'jc-low-candidate', org_id: 'org-1', name: 'Beto' }],
    })

    await recalculateShortlist(supabase, { job, unit, config })

    const row = db.job_candidates!.find((r) => r.id === 'jc-low')!
    expect(row.stage).toBe('disqualified')
    expect(String(row.stage_reason)).toMatch(/abaixo do corte/)
  })

  it('quando a shortlist atinge a meta, marca a vaga shortlist_ready e apresenta à empresa', async () => {
    const job = makeJob({ status: 'outreach', target_shortlist_size: 2 })
    const unit = makeUnit()
    const config = makeConfig()
    const { supabase, db } = createFakeSupabase({
      job_openings: [{ ...job }],
      job_candidates: [
        seedScreenedCandidate({ id: 'jc-1', ai_score: 90 }),
        seedScreenedCandidate({ id: 'jc-2', ai_score: 80 }),
      ],
      candidates: [
        { id: 'jc-1-candidate', org_id: 'org-1', name: 'Ana' },
        { id: 'jc-2-candidate', org_id: 'org-1', name: 'Beto' },
      ],
      leads: [{ id: 'lead-1', unit_id: 'unit-1', company_name: 'Empresa X', phone: null, email: 'empresa@x.com' }],
    })

    await recalculateShortlist(supabase, { job, unit, config })

    expect(db.job_candidates!.filter((r) => r.stage === 'shortlisted')).toHaveLength(2)
    expect(db.job_openings![0]!.status).toBe('shortlist_ready')
    expect(presentShortlist).toHaveBeenCalledTimes(1)
  })

  it('pipeline esgotado com menos candidatos que a meta ainda assim fica pronto (transparência, nunca infla com candidato ruim)', async () => {
    const job = makeJob({ status: 'outreach', target_shortlist_size: 5 })
    const unit = makeUnit()
    const config = makeConfig()
    const { supabase, db } = createFakeSupabase({
      job_openings: [{ ...job }],
      job_candidates: [seedScreenedCandidate({ id: 'jc-1', ai_score: 90 })],
      candidates: [{ id: 'jc-1-candidate', org_id: 'org-1', name: 'Ana' }],
      leads: [{ id: 'lead-1', unit_id: 'unit-1', company_name: 'Empresa X', phone: null, email: 'empresa@x.com' }],
    })

    await recalculateShortlist(supabase, { job, unit, config })

    expect(db.job_openings![0]!.status).toBe('shortlist_ready')
    expect(presentShortlist).toHaveBeenCalledTimes(1)
  })

  it('pipeline ainda em andamento (não esgotado) e abaixo da meta: aguarda, não apresenta nada ainda', async () => {
    const job = makeJob({ status: 'outreach', target_shortlist_size: 5 })
    const unit = makeUnit()
    const config = makeConfig()
    const { supabase, db } = createFakeSupabase({
      job_openings: [{ ...job }],
      job_candidates: [
        seedScreenedCandidate({ id: 'jc-1', ai_score: 90 }),
        { id: 'jc-2', job_id: 'job-1', candidate_id: 'jc-2-candidate', stage: 'contacted', ai_score: null, score_breakdown: {} },
      ],
      candidates: [
        { id: 'jc-1-candidate', org_id: 'org-1', name: 'Ana' },
        { id: 'jc-2-candidate', org_id: 'org-1', name: 'Carla' },
      ],
    })

    await recalculateShortlist(supabase, { job, unit, config })

    expect(db.job_openings![0]!.status).toBe('outreach')
    expect(presentShortlist).not.toHaveBeenCalled()
  })

  it('shortlist pronta mas vaga sem lead vinculado: escala para humano em vez de apresentar', async () => {
    const job = makeJob({ status: 'outreach', target_shortlist_size: 1, lead_id: null })
    const unit = makeUnit()
    const config = makeConfig()
    const { supabase, db } = createFakeSupabase({
      job_openings: [{ ...job }],
      job_candidates: [seedScreenedCandidate({ id: 'jc-1', ai_score: 90 })],
      candidates: [{ id: 'jc-1-candidate', org_id: 'org-1', name: 'Ana' }],
    })

    await recalculateShortlist(supabase, { job, unit, config })

    expect(presentShortlist).not.toHaveBeenCalled()
    expect(db.job_openings![0]!.status).toBe('escalated_human')
  })
})

describe('escalateJob', () => {
  it('move a vaga para escalated_human e registra decisão/evento', async () => {
    const job = makeJob({ status: 'outreach' })
    const unit = makeUnit()
    const { supabase, db } = createFakeSupabase({ job_openings: [{ ...job }] })

    await escalateJob(supabase, { job, unit, reason: 'motivo de teste' })

    expect(db.job_openings![0]!.status).toBe('escalated_human')
    expect(db.recruiter_decisions).toHaveLength(1)
    expect(db.recruiter_events).toHaveLength(1)
  })
})

describe('finalizeSelection', () => {
  it('aprova o candidato escolhido, reprova os demais com devolutiva, e transfere a vaga para humano (handed_off)', async () => {
    const job = makeJob({ status: 'company_review' })
    const unit = makeUnit()
    const config = makeConfig()
    const { supabase, db } = createFakeSupabase({
      job_openings: [{ ...job }],
      job_candidates: [
        seedScreenedCandidate({ id: 'jc-1', ai_score: 90, stage: 'presented' }),
        seedScreenedCandidate({ id: 'jc-2', ai_score: 80, stage: 'presented' }),
      ],
      candidates: [
        { id: 'jc-1-candidate', org_id: 'org-1', name: 'Ana', opted_out: false, consent_status: 'granted' },
        { id: 'jc-2-candidate', org_id: 'org-1', name: 'Beto', opted_out: false, consent_status: 'granted' },
      ],
      organizations: [{ id: 'org-1', owner_email: 'dono@empresa.com' }],
    })

    const result = await finalizeSelection(supabase, {
      job, unit, config, selectedJcId: 'jc-1', decidedBy: 'empresa confirmou',
    })

    expect(result.ok).toBe(true)
    expect(db.job_candidates!.find((r) => r.id === 'jc-1')!.stage).toBe('approved')
    expect(db.job_candidates!.find((r) => r.id === 'jc-2')!.stage).toBe('not_selected')
    expect(sendRejectionFeedback).toHaveBeenCalledTimes(1)
    expect(db.job_openings![0]!.status).toBe('handed_off')
    expect(db.job_openings![0]!.handed_off_to).toBe('dono@empresa.com')
  })

  it('retorna erro sem tocar no banco quando o candidato escolhido não está na vaga', async () => {
    const job = makeJob({ status: 'company_review' })
    const unit = makeUnit()
    const config = makeConfig()
    const { supabase, db } = createFakeSupabase({
      job_openings: [{ ...job }],
      job_candidates: [seedScreenedCandidate({ id: 'jc-1', ai_score: 90, stage: 'presented' })],
      candidates: [{ id: 'jc-1-candidate', org_id: 'org-1', name: 'Ana' }],
    })

    const result = await finalizeSelection(supabase, {
      job, unit, config, selectedJcId: 'jc-inexistente', decidedBy: 'x',
    })

    expect(result.ok).toBe(false)
    expect(db.job_candidates!.find((r) => r.id === 'jc-1')!.stage).toBe('presented')
    expect(db.job_openings![0]!.status).toBe('company_review')
  })
})

describe('cancelJob', () => {
  it('cancela a vaga e devolve feedback honesto a todos os candidatos em processo', async () => {
    const job = makeJob({ status: 'screening' })
    const unit = makeUnit()
    const config = makeConfig()
    const { supabase, db } = createFakeSupabase({
      job_openings: [{ ...job }],
      job_candidates: [
        seedScreenedCandidate({ id: 'jc-1', ai_score: 90, stage: 'in_screening' }),
        seedScreenedCandidate({ id: 'jc-2', ai_score: 80, stage: 'shortlisted' }),
      ],
      candidates: [
        { id: 'jc-1-candidate', org_id: 'org-1', name: 'Ana', opted_out: false, consent_status: 'granted' },
        { id: 'jc-2-candidate', org_id: 'org-1', name: 'Beto', opted_out: false, consent_status: 'granted' },
      ],
    })

    await cancelJob(supabase, { job, unit, config, reason: 'empresa desistiu' })

    expect(db.job_openings![0]!.status).toBe('cancelled')
    expect(db.job_candidates!.every((r) => r.stage === 'not_selected')).toBe(true)
    expect(sendRejectionFeedback).toHaveBeenCalledTimes(2)
  })
})
