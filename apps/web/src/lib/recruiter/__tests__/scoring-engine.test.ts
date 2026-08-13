import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { computeWeightedScore, scoreCandidatesForJob } from '@/lib/recruiter/scoring-engine'
import { SCORING_RUBRIC } from '@/lib/recruiter/types'
import { makeCandidate, makeJob } from './fixtures'

// Estágio 3 do ranking (§8.2): rubrica LLM com pesos fixos. O cálculo do
// score ponderado é puro e determinístico — cobrimos um candidato bom e um
// ruim. scoreCandidatesForJob roda em lotes (BATCH_SIZE=6): um lote que
// falha (API externa fora do ar) não pode derrubar os demais lotes já
// pontuados — é o caso de erro tratado do pipeline de sourcing.

const { generateStructuredReply, getOpenAIApiKey } = vi.hoisted(() => ({
  generateStructuredReply: vi.fn(),
  getOpenAIApiKey: vi.fn((): string | null => 'fake-key'),
}))

vi.mock('@/lib/openai', () => ({ generateStructuredReply, getOpenAIApiKey }))

function fullMarksDimensions(score: number): Record<string, { score: number; justification: string }> {
  const dims: Record<string, { score: number; justification: string }> = {}
  for (const dim of SCORING_RUBRIC) dims[dim.key] = { score, justification: 'ok' }
  return dims
}

describe('computeWeightedScore', () => {
  it('candidato bom: notas altas em todas as dimensões geram score alto', () => {
    const score = computeWeightedScore(fullMarksDimensions(95))
    expect(score).toBe(95)
  })

  it('candidato ruim: notas baixas em todas as dimensões geram score baixo', () => {
    const score = computeWeightedScore(fullMarksDimensions(10))
    expect(score).toBe(10)
  })

  it('pondera pelo peso de cada dimensão da rubrica (não é média simples)', () => {
    // hard_skills pesa 25, expectations pesa só 5 — com todas as outras
    // dimensões zeradas, acertar em cheio a de maior peso deve valer bem
    // mais no score final do que acertar em cheio a de menor peso.
    const zeroed = fullMarksDimensions(0)
    const heavy = computeWeightedScore({ ...zeroed, hard_skills: { score: 100, justification: '' } })
    const light = computeWeightedScore({ ...zeroed, expectations: { score: 100, justification: '' } })
    expect(heavy).toBeGreaterThan(light)
  })

  it('ignora dimensões fora da rubrica e sem nota, sem quebrar', () => {
    expect(computeWeightedScore({})).toBe(0)
    expect(computeWeightedScore({ unknown_dimension: { score: 100, justification: '' } })).toBe(0)
  })

  it('trava a nota de cada dimensão em [0,100] mesmo se o modelo mandar fora do intervalo', () => {
    const score = computeWeightedScore(fullMarksDimensions(150))
    expect(score).toBe(100)
  })
})

describe('scoreCandidatesForJob', () => {
  beforeEach(() => {
    generateStructuredReply.mockReset()
    getOpenAIApiKey.mockReturnValue('fake-key')
  })

  it('retorna vazio sem candidatos, sem chamar a API', async () => {
    const { supabase } = createFakeSupabase()
    const job = makeJob()
    const result = await scoreCandidatesForJob({ supabase, job, candidates: [] })
    expect(result).toEqual([])
    expect(generateStructuredReply).not.toHaveBeenCalled()
  })

  it('lança quando OPENAI_API_KEY não está configurada', async () => {
    getOpenAIApiKey.mockReturnValueOnce(null)
    const { supabase } = createFakeSupabase()
    const job = makeJob()
    await expect(
      scoreCandidatesForJob({ supabase, job, candidates: [makeCandidate()] }),
    ).rejects.toThrow(/OPENAI_API_KEY/)
  })

  it('um lote falhando (API externa fora do ar) não derruba os lotes que já pontuaram — pipeline segue com o que deu certo', async () => {
    const { supabase } = createFakeSupabase()
    const job = makeJob()
    // BATCH_SIZE é 6: 8 candidatos => 2 lotes (6 + 2)
    const candidates = Array.from({ length: 8 }, (_, i) => makeCandidate({ id: `cand-${i + 1}` }))

    generateStructuredReply
      .mockImplementationOnce(async () => ({
        results: candidates.slice(0, 6).map((c, i) => ({ ref: `C${i + 1}`, dimensions: fullMarksDimensions(80) })),
      }))
      .mockImplementationOnce(async () => {
        throw new Error('OpenAI indisponível (simulado)')
      })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await scoreCandidatesForJob({ supabase, job, candidates })
    errorSpy.mockRestore()

    // Só o primeiro lote (6 candidatos) foi pontuado; o segundo lote (2
    // candidatos) falhou mas não lançou nem descartou o que já tinha dado certo.
    expect(result).toHaveLength(6)
    expect(result.every((r) => r.matchScore === 80)).toBe(true)
    expect(generateStructuredReply).toHaveBeenCalledTimes(2)
  })

  it('ordena os candidatos pontuados do maior para o menor match_score', async () => {
    const { supabase } = createFakeSupabase()
    const job = makeJob()
    const candidates = [makeCandidate({ id: 'cand-low' }), makeCandidate({ id: 'cand-high' })]

    generateStructuredReply.mockResolvedValueOnce({
      results: [
        { ref: 'C1', dimensions: fullMarksDimensions(30) },
        { ref: 'C2', dimensions: fullMarksDimensions(90) },
      ],
    })

    const result = await scoreCandidatesForJob({ supabase, job, candidates })
    expect(result.map((r) => r.candidateId)).toEqual(['cand-high', 'cand-low'])
  })
})
