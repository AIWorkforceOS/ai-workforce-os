import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import {
  canContactCandidate,
  canSendNow,
  containsHiringPromise,
  detectsNegotiationRequest,
  detectsOptOut,
  getRecruiterLimits,
} from '@/lib/recruiter/guardrails'
import { DEFAULT_RECRUITER_LIMITS } from '@/lib/recruiter/types'
import { makeCandidate, makeConfig } from './fixtures'

// Guard-rails (§11/§15/§18 da spec) são a última linha de defesa antes de
// qualquer mensagem sair — cobrimos aqui o filtro determinístico de
// promessa de contratação (§15.3) bloqueando de verdade texto que violaria
// a regra, e as checagens de horário/limite/consentimento que envolvem o
// Supabase fake.

describe('containsHiringPromise', () => {
  it('bloqueia mensagens que prometem contratação/aprovação', () => {
    expect(containsHiringPromise('Parabéns, você foi aprovado para a vaga!')).toBe(true)
    expect(containsHiringPromise('Pode ficar tranquilo, a vaga já é sua.')).toBe(true)
    expect(containsHiringPromise('Você tem vaga garantida com a gente.')).toBe(true)
    expect(containsHiringPromise('Garantimos sua contratação assim que possível.')).toBe(true)
    expect(containsHiringPromise('Com certeza você vai ser selecionado, fica tranquilo.')).toBe(true)
    expect(containsHiringPromise('Garantimos a sua contratação.')).toBe(true)
  })

  it('não bloqueia mensagens neutras sobre o andamento do processo', () => {
    expect(
      containsHiringPromise('Obrigado pelas respostas! Seu perfil segue para avaliação da empresa.'),
    ).toBe(false)
    expect(containsHiringPromise('Vamos te atualizar assim que a empresa decidir.')).toBe(false)
    expect(containsHiringPromise('Você está entre os candidatos triados, mas a decisão é da empresa.')).toBe(false)
  })
})

describe('detectsOptOut', () => {
  it('detecta pedidos de descadastro em variações comuns', () => {
    expect(detectsOptOut('Não quero mais receber mensagens, por favor')).toBe(true)
    expect(detectsOptOut('Pode me tirem da lista de vocês')).toBe(true)
    expect(detectsOptOut('Pode me tirar da lista de vocês')).toBe(true)
    expect(detectsOptOut('quero descadastrar meu contato')).toBe(true)
  })

  it('não marca opt-out em mensagens comuns de triagem', () => {
    expect(detectsOptOut('Tenho disponibilidade de horário total')).toBe(false)
  })
})

describe('detectsNegotiationRequest', () => {
  it('detecta pedido de negociar bolsa/salário', () => {
    expect(detectsNegotiationRequest('Dá pra negociar a bolsa? Achei baixa.')).toBe(true)
    expect(detectsNegotiationRequest('O valor é negociável?')).toBe(true)
  })

  it('não marca negociação em pergunta neutra sobre valor', () => {
    expect(detectsNegotiationRequest('Qual é o valor da bolsa?')).toBe(false)
  })
})

describe('getRecruiterLimits', () => {
  it('usa os defaults quando escalation_rules não sobrescreve nada', () => {
    const config = makeConfig({ escalation_rules: { after_messages: 5, keywords: [] } })
    expect(getRecruiterLimits(config)).toEqual(DEFAULT_RECRUITER_LIMITS)
  })

  it('sobrescreve limites individuais via escalation_rules, ignorando valores inválidos', () => {
    const config = makeConfig({
      escalation_rules: {
        after_messages: 5,
        keywords: [],
        screening_score_cutoff: 75,
        candidate_attempts_max: -3, // inválido (<=0) — cai no default
      } as unknown as { after_messages: number; keywords: string[] },
    })
    const limits = getRecruiterLimits(config)
    expect(limits.screening_score_cutoff).toBe(75)
    expect(limits.candidate_attempts_max).toBe(DEFAULT_RECRUITER_LIMITS.candidate_attempts_max)
  })
})

describe('canContactCandidate', () => {
  it('bloqueia candidato com opt-out', () => {
    const result = canContactCandidate(makeCandidate({ opted_out: true }))
    expect(result.ok).toBe(false)
  })

  it('bloqueia candidato com consentimento revogado', () => {
    const result = canContactCandidate(makeCandidate({ consent_status: 'revoked' }))
    expect(result.ok).toBe(false)
  })

  it('permite candidato com consentimento válido', () => {
    const result = canContactCandidate(makeCandidate())
    expect(result.ok).toBe(true)
  })
})

describe('canSendNow', () => {
  it('bloqueia fora do horário ativo configurado', async () => {
    const { supabase } = createFakeSupabase()
    const config = makeConfig({ active_hours: { start: '00:00', end: '00:01', days: [] } })
    const result = await canSendNow(supabase, config, 'unit-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/horário ativo/)
  })

  it('bloqueia quando o limite diário compartilhado (SDR + Recruiter) já foi atingido', async () => {
    const { supabase } = createFakeSupabase({
      candidate_messages: [
        { id: 'm1', unit_id: 'unit-1', direction: 'outbound', sent_at: new Date().toISOString() },
        { id: 'm2', unit_id: 'unit-1', direction: 'outbound', sent_at: new Date().toISOString() },
      ],
    })
    const config = makeConfig({ daily_limit: 2 })
    const result = await canSendNow(supabase, config, 'unit-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/limite diário/)
  })

  it('permite envio dentro do horário e abaixo do limite diário', async () => {
    const { supabase } = createFakeSupabase({ candidate_messages: [] })
    const config = makeConfig({ daily_limit: 10 })
    const result = await canSendNow(supabase, config, 'unit-1')
    expect(result.ok).toBe(true)
  })
})
