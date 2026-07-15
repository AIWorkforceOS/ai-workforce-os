import { describe, expect, it } from 'vitest'
import {
  FINAL_QUESTION,
  buildBusinessContext,
  isInterviewAgentType,
  mergeProfile,
  reduceInterview,
} from '../engine'
import type { InterviewTranscriptEntry } from '@/lib/types'

// A regra verbatim do produto: "a última pergunta precisa ser sempre se
// tem algo mais para passar". reduceInterview garante isso em código,
// independente do que o modelo decidir — estes testes são o contrato.

const finalAskedTranscript: InterviewTranscriptEntry[] = [
  { role: 'assistant', content: 'O que a empresa vende?' },
  { role: 'user', content: 'Vendemos 3 planos de software.' },
  { role: 'assistant', content: FINAL_QUESTION, asked_final: true },
  { role: 'user', content: 'Não, é isso. Pode começar!' },
]

describe('reduceInterview — regra da pergunta final', () => {
  it('não deixa encerrar sem a pergunta final ter sido feita: converte a mensagem na pergunta final', () => {
    const result = reduceInterview({
      profile: {},
      transcript: [
        { role: 'assistant', content: 'O que vocês vendem?' },
        { role: 'user', content: 'Consultoria financeira.' },
      ],
      output: { message: 'Perfeito, já sei tudo!', interview_complete: true },
    })

    expect(result.done).toBe(false)
    expect(result.reply).toContain(FINAL_QUESTION)
    const last = result.transcript[result.transcript.length - 1]!
    expect(last.role).toBe('assistant')
    expect(last.asked_final).toBe(true)
  })

  it('flags de pergunta final e encerramento no MESMO turno valem como pergunta final (ainda não encerra)', () => {
    const result = reduceInterview({
      profile: {},
      transcript: [
        { role: 'assistant', content: 'O que a empresa vende?' },
        { role: 'user', content: 'Vendemos consultoria.' },
      ],
      output: {
        message: 'Tem mais alguma coisa que eu deveria saber?',
        asked_final_question: true,
        interview_complete: true,
      },
    })

    expect(result.done).toBe(false)
    expect(result.transcript[result.transcript.length - 1]!.asked_final).toBe(true)
  })

  it('registra a pergunta final quando o modelo a faz, sem encerrar', () => {
    const result = reduceInterview({
      profile: {},
      transcript: [
        { role: 'assistant', content: 'Qual a política de desconto?' },
        { role: 'user', content: 'Até 10%.' },
      ],
      output: { message: 'Anotado! Tem mais alguma coisa que eu deveria saber?', asked_final_question: true },
    })

    expect(result.done).toBe(false)
    expect(result.transcript[result.transcript.length - 1]!.asked_final).toBe(true)
  })

  it('encerra quando a pergunta final já foi feita e o chefe respondeu que não há mais nada', () => {
    const result = reduceInterview({
      profile: { produtos: [{ nome: 'Plano X' }] },
      transcript: finalAskedTranscript,
      output: { message: 'Obrigado! Estou pronto pra começar.', interview_complete: true },
    })

    expect(result.done).toBe(true)
    expect(result.reply).toBe('Obrigado! Estou pronto pra começar.')
  })

  it('se a resposta à pergunta final trouxe algo novo e o modelo refaz a pergunta final, não encerra ainda', () => {
    const result = reduceInterview({
      profile: {},
      transcript: [
        ...finalAskedTranscript.slice(0, 3),
        { role: 'user', content: 'Ah, uma coisa: nunca atenda sábado.' },
      ],
      output: {
        message: 'Anotado! Tem mais alguma coisa?',
        profile_updates: { observacoes: ['nunca atender sábado'] },
        asked_final_question: true,
        interview_complete: true,
      },
    })

    expect(result.done).toBe(false)
    expect(result.profile.observacoes).toEqual(['nunca atender sábado'])
    expect(result.transcript[result.transcript.length - 1]!.asked_final).toBe(true)
  })

  it('usa mensagem de fallback quando o modelo encerra sem texto', () => {
    const result = reduceInterview({
      profile: {},
      transcript: finalAskedTranscript,
      output: { interview_complete: true },
    })

    expect(result.done).toBe(true)
    expect(result.reply.length).toBeGreaterThan(0)
  })

  it('acumula o perfil a cada turno', () => {
    const result = reduceInterview({
      profile: { tipo_cliente: 'b2b' },
      transcript: [
        { role: 'assistant', content: 'Quais os preços?' },
        { role: 'user', content: 'Plano X custa R$100, Plano Y R$200.' },
      ],
      output: {
        message: 'E qual a política de desconto?',
        profile_updates: {
          produtos: [
            { nome: 'Plano X', preco: 'R$100' },
            { nome: 'Plano Y', preco: 'R$200' },
          ],
        },
      },
    })

    expect(result.done).toBe(false)
    expect(result.profile.tipo_cliente).toBe('b2b')
    expect(result.profile.produtos).toHaveLength(2)
  })
})

describe('mergeProfile', () => {
  it('valores vazios não apagam o que já foi aprendido', () => {
    const merged = mergeProfile(
      { politica_desconto: 'até 10%', produtos: [{ nome: 'X' }] },
      { politica_desconto: '', produtos: [], observacoes: null as unknown as undefined },
    )
    expect(merged.politica_desconto).toBe('até 10%')
    expect(merged.produtos).toHaveLength(1)
  })

  it('objetos aninhados são fundidos, não substituídos', () => {
    const merged = mergeProfile(
      { prospeccao: { tipos_empresa: ['clínicas'] } },
      { prospeccao: { regioes: ['São Paulo'] } },
    )
    expect(merged.prospeccao).toEqual({ tipos_empresa: ['clínicas'], regioes: ['São Paulo'] })
  })

  it('listas novas substituem as antigas (o prompt pede a lista completa atualizada)', () => {
    const merged = mergeProfile(
      { produtos: [{ nome: 'X' }] },
      { produtos: [{ nome: 'X', preco: 'R$100' }, { nome: 'Y', preco: 'R$200' }] },
    )
    expect(merged.produtos).toHaveLength(2)
  })
})

describe('buildBusinessContext', () => {
  it('retorna null sem perfil (preserva o comportamento antigo dos prompts)', () => {
    expect(buildBusinessContext(null)).toBeNull()
    expect(buildBusinessContext(undefined)).toBeNull()
    expect(buildBusinessContext({})).toBeNull()
  })

  it('embute o perfil aprendido como ficha da empresa', () => {
    const context = buildBusinessContext({ politica_desconto: 'até 10%' })
    expect(context).toContain('FICHA DA EMPRESA')
    expect(context).toContain('até 10%')
  })
})

describe('isInterviewAgentType', () => {
  it('aceita os 3 funcionários digitais e rejeita o resto', () => {
    expect(isInterviewAgentType('sdr')).toBe(true)
    expect(isInterviewAgentType('recruiter')).toBe(true)
    expect(isInterviewAgentType('traffic_specialist')).toBe(true)
    expect(isInterviewAgentType('support')).toBe(false)
  })
})
