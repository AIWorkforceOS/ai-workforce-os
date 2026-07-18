import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { buildSystemPrompt, closingFields, isAutoRecruitmentDeal } from '@/lib/conversation-engine'
import { handleSalesDealHandoff } from '@/lib/sales/deal-handoff'
import type { AgentConfig, Lead, Unit } from '@/lib/types'
import type { JobOpening } from '@/lib/recruiter/types'

// Contrato do produto: o que acontece no fechamento é INTEIRAMENTE
// definido pelo que foi ensinado na entrevista daquela instância do
// Sales Rep (business_profile.fechamento_campos/fechamento_acao/
// fechamento_cria_vaga_recrutamento) — nunca uma categoria fixa no
// código. Estes testes não chamam a OpenAI (ao contrário de
// deal-handoff.e2e.test.ts): cobrem só a lógica pura e o handoff contra
// um Supabase fake, comparando 3 negócios bem diferentes entre si para
// provar que nada ficou hardcoded para "recrutamento".

const unit: Unit = {
  id: 'unit-1',
  org_id: 'org-1',
  name: 'Unidade Teste',
  slug: 'unidade-teste',
  whatsapp_instance_id: null,
  whatsapp_phone: '5511999999999',
  email_from: null,
  email_reply_to: null,
  logo_url: null,
  region_city: 'São Paulo',
  region_state: 'SP',
  evolution_api_url: null,
  evolution_api_key: null,
  evolution_instance_name: null,
  messaging_channel: null,
  twilio_account_sid: null,
  twilio_auth_token: null,
  twilio_phone_number: null,
  default_conversation_language: null,
  intake_token: null,
  crm_integration_mode: 'native',
  smarter_crm_partner_token: null,
      recruiting_integration_mode: 'native',
      smarter_recruiting_partner_token: null,
      smarter_recruiting_company_id: null,
      smarter_marketing_partner_token: null,
      public_lead_intake_token: null,
  is_active: true,
  created_at: '',
  updated_at: '',
}

function makeConfig(businessProfile: Record<string, unknown>): AgentConfig {
  return {
    id: 'cfg-sdr',
    unit_id: unit.id,
    agent_type: 'sdr',
    persona_name: 'Kai',
    persona_tone: 'friendly',
    daily_limit: 50,
    active_hours: { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] },
    escalation_rules: { after_messages: 999, keywords: [] },
    sectors: [],
    is_active: true,
    business_profile: businessProfile,
    interview_status: 'completed',
    interview_transcript: [],
    created_at: '',
    updated_at: '',
  }
}

function makeLead(overrides: Partial<Lead>): Lead {
  return {
    id: 'lead-1',
    unit_id: unit.id,
    company_name: 'Empresa Teste',
    contact_name: null,
    phone: '5511988887777',
    email: null,
    sector: null,
    city: null,
    state: null,
    source: 'google_maps',
    status: 'replied',
    google_place_id: null,
    notes: null,
    last_contacted_at: null,
    deal_profile: {},
    deal_closed_at: null,
    smarter_crm_lead_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

// Cenário 1 — recrutamento/estágio (o vertical original): ensina campos
// de vaga e a automação explícita de criar job_opening.
const recruitmentProfile = {
  sobre_a_empresa: 'Agência de estágios.',
  fechamento: 'fecha_sozinho',
  fechamento_cria_vaga_recrutamento: true,
  fechamento_acao: 'Criar a vaga e mandar pro Recrutador.',
  fechamento_campos: [
    { chave: 'course', pergunta: 'qual curso o estagiário precisa ter' },
    { chave: 'city', pergunta: 'em qual cidade' },
    { chave: 'modality', pergunta: 'modalidade: presencial, híbrido ou remoto' },
    { chave: 'positions_needed', pergunta: 'quantas vagas' },
  ],
}

// Cenário 2 — franquia (Smarter vendendo a própria franquia): dados de
// contrato completamente diferentes de recrutamento, sem automação.
const franchiseProfile = {
  sobre_a_empresa: 'Rede de franquias Smarter.',
  fechamento: 'fecha_sozinho',
  fechamento_cria_vaga_recrutamento: false,
  fechamento_acao:
    'Coletar CPF/CNPJ e endereço completo, e notificar o setor jurídico/financeiro para emitir o contrato de franquia.',
  fechamento_campos: [
    { chave: 'cpf_cnpj', pergunta: 'CPF ou CNPJ do responsável' },
    { chave: 'endereco', pergunta: 'endereço completo para o contrato' },
  ],
}

// Cenário 3 — Mawi Services (limpeza comercial nos EUA): nenhum campo
// estruturado ensinado, só uma ação de encaminhamento pro comercial humano.
const cleaningServicesProfile = {
  sobre_a_empresa: 'Mawi Services — limpeza comercial para empresas nos EUA.',
  fechamento: 'fecha_sozinho',
  fechamento_cria_vaga_recrutamento: false,
  fechamento_acao: 'Só registrar o interesse e notificar o time comercial humano para fechar por telefone.',
  fechamento_campos: [],
}

describe('closingFields / isAutoRecruitmentDeal — nada hardcoded por vertical', () => {
  it('lê os campos ensinados de cada configuração, sem assumir um formato fixo', () => {
    expect(closingFields(recruitmentProfile).map((f) => f.chave)).toEqual([
      'course',
      'city',
      'modality',
      'positions_needed',
    ])
    expect(closingFields(franchiseProfile).map((f) => f.chave)).toEqual(['cpf_cnpj', 'endereco'])
    expect(closingFields(cleaningServicesProfile)).toEqual([])
  })

  it('só automatiza a criação de vaga quando isso foi explicitamente ensinado', () => {
    expect(isAutoRecruitmentDeal(recruitmentProfile)).toBe(true)
    expect(isAutoRecruitmentDeal(franchiseProfile)).toBe(false)
    expect(isAutoRecruitmentDeal(cleaningServicesProfile)).toBe(false)
  })
})

describe('buildSystemPrompt — o agente só pede o que foi ensinado para ESTA configuração', () => {
  it('recrutamento: pergunta os campos de vaga, nunca CPF/CNPJ', () => {
    const prompt = buildSystemPrompt(makeConfig(recruitmentProfile), unit)
    expect(prompt).toContain('qual curso o estagiário precisa ter')
    expect(prompt).toContain('Criar a vaga e mandar pro Recrutador')
    expect(prompt).not.toContain('CPF')
  })

  it('franquia: pergunta CPF/CNPJ e endereço, nunca curso/modalidade de vaga', () => {
    const prompt = buildSystemPrompt(makeConfig(franchiseProfile), unit)
    expect(prompt).toContain('CPF ou CNPJ do responsável')
    expect(prompt).toContain('emitir o contrato de franquia')
    expect(prompt).not.toContain('qual curso')
  })

  it('Mawi Services: sem campos ensinados, não inventa nenhum', () => {
    const prompt = buildSystemPrompt(makeConfig(cleaningServicesProfile), unit)
    expect(prompt).toContain('não ensinou nenhum dado específico')
    expect(prompt).toContain('notificar o time comercial humano')
    expect(prompt).not.toContain('qual curso')
    expect(prompt).not.toContain('CPF')
  })
})

describe('handleSalesDealHandoff — a ação executada é a que foi ensinada, não uma categoria fixa', () => {
  it('recrutamento: cria a job_opening automaticamente', async () => {
    const lead = makeLead({
      deal_profile: { course: 'Marketing', city: 'São Paulo', modality: 'híbrido', positions_needed: 2 },
    })
    const { supabase, db } = createFakeSupabase({
      agent_configs: [makeConfig(recruitmentProfile) as unknown as Record<string, unknown>],
      leads: [lead as unknown as Record<string, unknown>],
    })

    await handleSalesDealHandoff(supabase, { leadId: lead.id, unit })

    const jobs = (db.job_openings ?? []) as unknown as JobOpening[]
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.profile.course).toBe('Marketing')
    expect(jobs[0]!.profile.city).toBe('São Paulo')

    const events = (db.system_events ?? []) as Record<string, unknown>[]
    expect(events.some((e) => e.event_type === 'deal_won')).toBe(false)
  })

  it('franquia: NÃO cria vaga — registra a ação ensinada com os dados coletados', async () => {
    const lead = makeLead({
      deal_profile: { cpf_cnpj: '123.456.789-00', endereco: 'Rua das Franquias, 100' },
    })
    const { supabase, db } = createFakeSupabase({
      agent_configs: [makeConfig(franchiseProfile) as unknown as Record<string, unknown>],
      leads: [lead as unknown as Record<string, unknown>],
    })

    await handleSalesDealHandoff(supabase, { leadId: lead.id, unit })

    expect((db.job_openings ?? [])).toHaveLength(0)

    const events = (db.system_events ?? []) as Record<string, unknown>[]
    const dealEvent = events.find((e) => e.event_type === 'deal_won')
    expect(dealEvent).toBeTruthy()
    expect(String(dealEvent!.message)).toContain('contrato de franquia')
    expect((dealEvent!.metadata as Record<string, unknown>).deal_profile).toEqual(lead.deal_profile)
  })

  it('Mawi Services (limpeza comercial): NÃO cria vaga — registra o encaminhamento ao time humano', async () => {
    const lead = makeLead({ deal_profile: {} })
    const { supabase, db } = createFakeSupabase({
      agent_configs: [makeConfig(cleaningServicesProfile) as unknown as Record<string, unknown>],
      leads: [lead as unknown as Record<string, unknown>],
    })

    await handleSalesDealHandoff(supabase, { leadId: lead.id, unit })

    expect((db.job_openings ?? [])).toHaveLength(0)

    const events = (db.system_events ?? []) as Record<string, unknown>[]
    const dealEvent = events.find((e) => e.event_type === 'deal_won')
    expect(dealEvent).toBeTruthy()
    expect(String(dealEvent!.message)).toContain('time comercial humano')
  })
})
