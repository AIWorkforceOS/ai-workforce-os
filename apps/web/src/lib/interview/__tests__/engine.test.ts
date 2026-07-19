import { describe, expect, it } from 'vitest'
import {
  FINAL_QUESTION,
  buildBusinessContext,
  buildCombinedBusinessContext,
  buildInterviewerPrompt,
  extractOrganizationIntake,
  isInterviewAgentType,
  mergeProfile,
  reduceInterview,
} from '../engine'
import type { AgentConfig, InterviewTranscriptEntry, Unit } from '@/lib/types'

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

describe('buildCombinedBusinessContext — Ficha da Empresa compartilhada (migration 025)', () => {
  const agentProfile = { politica_desconto: 'até 10%' }

  it('regressão: com a ficha da organização vazia (todas as orgs hoje), o texto é IDÊNTICO ao de buildBusinessContext sozinho', () => {
    expect(buildCombinedBusinessContext({}, agentProfile)).toBe(buildBusinessContext(agentProfile))
    expect(buildCombinedBusinessContext(null, agentProfile)).toBe(buildBusinessContext(agentProfile))
    expect(buildCombinedBusinessContext(undefined, agentProfile)).toBe(buildBusinessContext(agentProfile))
  })

  it('regressão: sem nenhum dos dois perfis, continua null', () => {
    expect(buildCombinedBusinessContext({}, {})).toBeNull()
    expect(buildCombinedBusinessContext(null, null)).toBeNull()
  })

  it('quando a organização já tem ficha, soma as duas com rótulos distintos', () => {
    const combined = buildCombinedBusinessContext({ nome_empresa: 'Acme' }, agentProfile)
    expect(combined).toContain('FICHA COMPARTILHADA DA EMPRESA')
    expect(combined).toContain('Acme')
    expect(combined).toContain('INFORMAÇÕES ESPECÍFICAS DESTE FUNCIONÁRIO')
    expect(combined).toContain('até 10%')
  })

  it('ficha da organização sozinha (agente ainda sem entrevista) não quebra', () => {
    const combined = buildCombinedBusinessContext({ nome_empresa: 'Acme' }, null)
    expect(combined).toContain('FICHA COMPARTILHADA DA EMPRESA')
    expect(combined).not.toContain('INFORMAÇÕES ESPECÍFICAS')
  })
})

describe('extractOrganizationIntake', () => {
  it('null enquanto o segmento não foi confirmado', () => {
    expect(extractOrganizationIntake({})).toBeNull()
    expect(extractOrganizationIntake({ org_vertical_key: 'cleaning_services' })).toBeNull()
    expect(extractOrganizationIntake({ org_vertical_key: 'cleaning_services', org_vertical_confirmed: false })).toBeNull()
  })

  it('null com vertical_key inválida mesmo confirmada', () => {
    expect(extractOrganizationIntake({ org_vertical_key: 'inventado', org_vertical_confirmed: true })).toBeNull()
  })

  it('extrai vertical_key + business_profile só com os campos org_* presentes, sem o prefixo', () => {
    const result = extractOrganizationIntake({
      org_vertical_key: 'therapy_clinic',
      org_vertical_confirmed: true,
      org_company_name: 'Clínica Bem-Estar',
      org_languages: ['pt', 'en'],
      fechamento: 'fecha_sozinho', // campo específico do agente — não deve vazar pro business_profile da org
    })
    expect(result).toEqual({
      vertical_key: 'therapy_clinic',
      business_profile: { company_name: 'Clínica Bem-Estar', languages: ['pt', 'en'] },
    })
  })
})

describe('runInterviewTurn — gate da Ficha da Empresa compartilhada', () => {
  const unit = { name: 'Unidade Teste', region_city: 'Campinas' } as Unit
  const config = {
    id: 'cfg-1',
    unit_id: 'unit-1',
    agent_type: 'sdr',
    persona_name: 'Kai',
    persona_tone: 'friendly',
    daily_limit: 15,
    active_hours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    escalation_rules: { after_messages: 5, keywords: [] },
    sectors: [],
    is_active: false,
    created_at: '',
    updated_at: '',
  } as AgentConfig

  it('sem includeOrgIntake (comportamento padrão), o prompt não pergunta segmento/identidade compartilhada', () => {
    const prompt = buildInterviewerPrompt({ config, unit, profile: {}, finalAlreadyAsked: false })
    expect(prompt).not.toContain('Ficha da Empresa compartilhada')
    expect(prompt).not.toContain('org_vertical_key')
  })

  it('com includeOrgIntake=true, o prompt inclui o segmento e os fatos de identidade antes do roteiro do cargo', () => {
    const prompt = buildInterviewerPrompt({ config, unit, profile: {}, finalAlreadyAsked: false, includeOrgIntake: true })
    expect(prompt).toContain('segmento principal do negócio')
    expect(prompt).toContain('org_vertical_confirmed')
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
