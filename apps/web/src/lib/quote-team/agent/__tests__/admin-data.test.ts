import { describe, expect, it } from 'vitest'
import { pilotStateOf, summarizePilot, type PilotDraft, type PilotJob, type PilotReview } from '../admin-data'

const job = (over: Partial<PilotJob> = {}): PilotJob => ({ id: 'j', appointment_id: 'a1', status: 'completed', stage: 'done', rounds: 1, spent_usd: 0.1, reserved_usd: 0, unconfirmed_usd: 0, budget_usd: 0.6, ai_calls: 4, created_at: '2026-10-20T10:00:00Z', started_at: '2026-10-20T10:00:05Z', finished_at: '2026-10-20T10:01:30Z', error_code: null, ...over })
const draft = (over: Partial<PilotDraft> = {}): PilotDraft => ({ appointment_id: 'a1', version: 1, status: 'draft', technical_check: 'needs_confirmation', pending_price_count: 2, materials_total_micros: 0, approved_at: null, created_at: '2026-10-20T10:01:30Z', edited_fields: [], ...over })

describe('pilotStateOf', () => {
  it('mapeia job + versão para o estado de negócio', () => {
    expect(pilotStateOf(job({ status: 'running' }), null)).toBe('processing')
    expect(pilotStateOf(job({ status: 'needs_input' }), null)).toBe('awaiting_info')
    expect(pilotStateOf(job(), draft())).toBe('awaiting_approval')
    expect(pilotStateOf(job(), draft({ status: 'approved' }))).toBe('approved')
    expect(pilotStateOf(job({ status: 'failed' }), null)).toBe('failed')
    expect(pilotStateOf(job({ status: 'budget_exhausted' }), null)).toBe('budget_exhausted')
    expect(pilotStateOf(job({ status: 'budget_exhausted' }), draft())).toBe('awaiting_approval')
  })
})

describe('summarizePilot', () => {
  const jobs = [job(), job({ id: 'j2', appointment_id: 'a2', spent_usd: 0.5, unconfirmed_usd: 0.05, rounds: 3, status: 'failed', finished_at: null }), job({ id: 'j3', appointment_id: 'a3', status: 'running', finished_at: null })]
  const drafts = [draft(), draft({ version: 2, status: 'approved', approved_at: 'x', pending_price_count: 0 }), draft({ appointment_id: 'a3', pending_price_count: 3 })]
  const reviews: PilotReview[] = [{ appointment_id: 'a1', diagnosis_verdict: 'partial', materials_correct: 3, materials_incorrect: 1, hours_suggested: 2, hours_final: 3, manual_interventions: 1 }]
  const s = summarizePilot({ jobs, drafts, reviews, messages: [{ appointment_id: 'a2', role: 'agent', kind: 'question' }, { appointment_id: 'a2', role: 'technician', kind: 'answer' }], monthSpentUsd: 41, monthlyCapUsd: 50 })

  it('conta por estado usando a versão MAIS RECENTE', () => {
    expect(s.total).toBe(3)
    expect(s.byState).toMatchObject({ approved: 1, failed: 1, processing: 1 })
  })
  it('tempo médio, custo por cotação, revisões e perguntas', () => {
    expect(s.avgProcessingSeconds).toBe(90)
    expect(s.totalCostUsd).toBeCloseTo(0.1 + 0.55 + 0.1)
    expect(s.maxCostUsd).toBeCloseTo(0.55)
    expect(s.revisions).toBe(2)
    expect(s.questionsPerQuote).toBeCloseTo(1 / 3)
  })
  it('avaliação humana e horas sugeridas × ajustadas', () => {
    expect(s.verdicts).toMatchObject({ partial: 1, correct: 0, incorrect: 0 })
    expect(s.materialsCorrect).toBe(3)
    expect(s.hoursSuggestedVsFinal).toEqual({ quotes: 1, avgDeltaHours: 1 })
  })
  it('materiais pendentes só das versões ainda em rascunho', () => {
    expect(s.pendingPriceItems).toBe(3)
  })
  it('alertas: consumo mensal ≥ 80%, cotação perto do teto, falha e reserva não confirmada', () => {
    expect(s.alerts.join('\n')).toMatch(/82%/)
    expect(s.alerts.join('\n')).toMatch(/80% ou mais do teto/)
    expect(s.alerts.join('\n')).toMatch(/falha/)
    expect(s.alerts.join('\n')).toMatch(/não confirmadas/)
  })
  it('sem dados: métricas nulas, sem alertas', () => {
    const e = summarizePilot({ jobs: [], drafts: [], reviews: [], messages: [], monthSpentUsd: 0, monthlyCapUsd: 50 })
    expect(e).toMatchObject({ total: 0, avgProcessingSeconds: null, avgCostUsd: null, alerts: [] })
  })
})
