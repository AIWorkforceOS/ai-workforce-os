import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import {
  CANDIDATE_SOURCE_MANUAL,
  CANDIDATE_SOURCE_PUBLIC_APPLICATION,
  addCandidateToJobPipeline,
  findOrCreateCandidate,
} from '@/lib/recruiter/candidate-intake'
import type { JobOpening } from '@/lib/recruiter/types'

// Cobre a infraestrutura de intake independente da Smarter (auditoria,
// gap fase 3/3): cadastro manual e candidatura pública precisam
// deduplicar contra a base existente e entrar no MESMO pipeline
// job_candidates que o sourcing automático usa — nunca um pipeline
// paralelo. Sem chamar a OpenAI de verdade: getOpenAIApiKey mockado
// para exercitar tanto o caminho pontuado quanto o degradado.

vi.mock('@/lib/openai', () => ({
  getOpenAIApiKey: vi.fn(() => null),
}))

function makeJob(overrides: Partial<JobOpening> = {}): JobOpening {
  return {
    id: 'job-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    lead_id: null,
    title: 'Estagiário de Marketing',
    status: 'outreach',
    previous_status: null,
    profile: {},
    profile_missing_fields: [],
    target_shortlist_size: 5,
    urgency: 'normal',
    hiring_deadline: null,
    source: 'manual',
    stalled_since: null,
    follow_up_count: 0,
    selected_candidate_id: null,
    handed_off_to: null,
    smarter_recruiting_vacancy_id: null,
    public_application_token: 'token-abc',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('findOrCreateCandidate', () => {
  it('cria um novo candidato quando não há match por telefone/e-mail', async () => {
    const { supabase, db } = createFakeSupabase()
    const result = await findOrCreateCandidate(supabase, {
      orgId: 'org-1',
      source: CANDIDATE_SOURCE_MANUAL,
      name: 'Ana Souza',
      email: 'ana@example.com',
      phone: '11999998888',
    })

    expect(result.created).toBe(true)
    expect(db.candidates).toHaveLength(1)
    expect(db.candidates![0]).toMatchObject({ name: 'Ana Souza', source: CANDIDATE_SOURCE_MANUAL, consent_status: 'granted' })
  })

  it('reaproveita candidato existente pelo telefone (não duplica)', async () => {
    const { supabase, db } = createFakeSupabase({
      candidates: [
        { id: 'cand-1', org_id: 'org-1', phone: '11999998888', email: null, resume_url: null },
      ],
    })

    const result = await findOrCreateCandidate(supabase, {
      orgId: 'org-1',
      source: CANDIDATE_SOURCE_PUBLIC_APPLICATION,
      name: 'Ana Souza',
      phone: '(11) 99999-8888',
      resumeUrl: 'https://example.com/resume.pdf',
    })

    expect(result.created).toBe(false)
    expect(result.candidateId).toBe('cand-1')
    expect(db.candidates).toHaveLength(1)
    // enriquece o currículo vazio sem sobrescrever o candidato existente
    expect(db.candidates![0]!.resume_url).toBe('https://example.com/resume.pdf')
  })

  it('reaproveita candidato existente pelo e-mail quando o telefone não bate', async () => {
    const { supabase, db } = createFakeSupabase({
      candidates: [{ id: 'cand-2', org_id: 'org-1', phone: null, email: 'joao@example.com', resume_url: null }],
    })

    const result = await findOrCreateCandidate(supabase, {
      orgId: 'org-1',
      source: CANDIDATE_SOURCE_MANUAL,
      name: 'João Lima',
      email: 'JOAO@example.com',
      phone: null,
    })

    expect(result.created).toBe(false)
    expect(result.candidateId).toBe('cand-2')
    expect(db.candidates).toHaveLength(1)
  })
})

describe('addCandidateToJobPipeline', () => {
  it('sem OPENAI_API_KEY, entra como sourced (não trava, não reabre a vaga)', async () => {
    const job = makeJob({ status: 'stalled' })
    const { supabase, db } = createFakeSupabase({
      job_openings: [{ ...job }],
    })

    const result = await addCandidateToJobPipeline(supabase, { job, candidateId: 'cand-1' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.stage).toBe('sourced')
      expect(result.matchScore).toBeNull()
    }
    expect(db.job_candidates).toHaveLength(1)
    expect(db.job_candidates![0]).toMatchObject({ job_id: job.id, candidate_id: 'cand-1', stage: 'sourced', rank: 1 })
    // vaga stalled não é reaberta automaticamente sem pontuação (nada poderia processá-la mesmo)
    expect(db.job_openings![0]!.status).toBe('stalled')
  })

  it('recusa adicionar o mesmo candidato duas vezes na mesma vaga', async () => {
    const job = makeJob()
    const { supabase, db } = createFakeSupabase({
      job_candidates: [{ id: 'jc-1', job_id: job.id, candidate_id: 'cand-1' }],
    })

    const result = await addCandidateToJobPipeline(supabase, { job, candidateId: 'cand-1' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/já está no pipeline/)
    expect(db.job_candidates).toHaveLength(1)
  })
})
