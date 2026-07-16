import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { AgentConfig, Lead, Unit } from '@/lib/types'
import type { JobOpening } from '@/lib/recruiter/types'

// Fechamento de negócio DE VERDADE contra a OpenAI (item 2 do handoff
// Sales → Recrutador): um "cliente" confirma que quer fechar numa única
// mensagem de WhatsApp, com os dados que o Recrutador precisa (curso,
// cidade, modalidade, quantidade de vagas). Valida ponta a ponta que
// processInboundMessage detecta o fechamento, persiste o deal_profile e
// sinaliza o handoff, e que handleSalesDealHandoff cria a job_opening
// automaticamente com os dados certos — sem formulário nem etapa manual.
//
// Cobre também o caso de negócio genérico (não recrutamento): o
// handoff não pode inventar uma vaga que não faz sentido para uma
// empresa que só vende produto/serviço — só marca o lead como ganho.
//
// Supabase e Evolution API são fakes (in-memory / mock) — só a decisão
// do modelo é de verdade. Não roda no `pnpm test` normal (custa chamada
// de API): habilite com
//   RUN_LIVE_SALES_DEAL=1 pnpm vitest run src/lib/sales/__tests__/deal-handoff.e2e.test.ts

function loadOpenAIKey(): string | null {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  for (const rel of ['../../../../.env.local', '../../../../../../.env.local']) {
    try {
      const env = readFileSync(path.resolve(__dirname, rel), 'utf8')
      const match = env.match(/^OPENAI_API_KEY=(.+)$/m)
      const key = match?.[1]?.trim().replace(/^["']|["']$/g, '')
      if (key) return key
    } catch {
      // tenta o próximo caminho
    }
  }
  return null
}

const apiKey = process.env.RUN_LIVE_SALES_DEAL === '1' ? loadOpenAIKey() : null

vi.mock('@/lib/evolution', () => ({
  getEvolutionConfig: () => ({ apiUrl: 'https://fake-evolution.test', apiKey: 'fake', instanceName: 'fake' }),
  sendWhatsAppMessage: vi.fn(async () => ({ ok: true })),
}))

describe.skipIf(!apiKey)('handoff Sales → Recrutador no fechamento (live)', () => {
  it('conversa que fecha negócio cria a job_opening automaticamente com os dados certos', async () => {
    if (apiKey) process.env.OPENAI_API_KEY = apiKey

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
      is_active: true,
      created_at: '',
      updated_at: '',
    }

    const sdrConfig: AgentConfig = {
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
      business_profile: {
        sobre_a_empresa: 'Agência de estágios que coloca estudantes em empresas parceiras.',
        fechamento: 'fecha_sozinho',
        fechamento_cria_vaga_recrutamento: true,
        fechamento_acao: 'Criar a vaga e mandar pro Recrutador.',
        fechamento_campos: [
          { chave: 'course', pergunta: 'qual curso o estagiário precisa ter' },
          { chave: 'city', pergunta: 'em qual cidade' },
          { chave: 'modality', pergunta: 'modalidade: presencial, híbrido ou remoto' },
          { chave: 'positions_needed', pergunta: 'quantas vagas' },
        ],
      },
      interview_status: 'completed',
      interview_transcript: [],
      created_at: '',
      updated_at: '',
    }

    const lead: Lead = {
      id: 'lead-1',
      unit_id: unit.id,
      company_name: 'Clínica OdontoPrime',
      contact_name: 'Marcos',
      phone: '5511988887777',
      email: null,
      sector: 'saude',
      city: null,
      state: null,
      source: 'google_maps',
      status: 'replied',
      google_place_id: null,
      notes: null,
      last_contacted_at: new Date().toISOString(),
      deal_profile: {},
      deal_closed_at: null,
      smarter_crm_lead_id: null,
      created_at: '',
      updated_at: '',
    }

    const { supabase, db } = createFakeSupabase({
      agent_configs: [sdrConfig as unknown as Record<string, unknown>],
      leads: [lead as unknown as Record<string, unknown>],
    })

    const { processInboundMessage } = await import('@/lib/conversation-engine')

    const incomingText =
      'Fechado, pode seguir! Preciso de 2 estagiários de Marketing, aqui em São Paulo, modelo híbrido, o quanto antes.'

    const result = await processInboundMessage({ supabase, unit, lead, incomingText })

    expect(result.dealHandoffReady).toBe(true)

    const updatedLead = db.leads?.find((row) => row.id === lead.id) as unknown as Lead
    expect(updatedLead.status).toBe('won')
    expect(updatedLead.deal_closed_at).toBeTruthy()

    const dealProfile = updatedLead.deal_profile as Record<string, unknown>
    expect(String(dealProfile.course ?? '')).toMatch(/marketing/i)
    expect(String(dealProfile.city ?? '')).toMatch(/s[ãa]o paulo/i)
    expect(String(dealProfile.modality ?? '')).toMatch(/h[íi]brid/i)
    expect(Number(dealProfile.positions_needed)).toBe(2)

    const { handleSalesDealHandoff } = await import('@/lib/sales/deal-handoff')
    await handleSalesDealHandoff(supabase, { leadId: lead.id, unit })

    const jobs = (db.job_openings ?? []) as unknown as JobOpening[]
    expect(jobs).toHaveLength(1)
    const job = jobs[0]!
    expect(job.source).toBe('sales_employee')
    expect(job.lead_id).toBe(lead.id)
    expect(job.profile.course).toMatch(/marketing/i)
    expect(job.profile.city).toMatch(/s[ãa]o paulo/i)
    expect(job.target_shortlist_size).toBeGreaterThanOrEqual(3)
    expect(job.target_shortlist_size).toBeLessThanOrEqual(5)

    // Idempotência: fechar de novo (ex.: retry de webhook) não duplica a vaga.
    await handleSalesDealHandoff(supabase, { leadId: lead.id, unit })
    expect((db.job_openings ?? []).length).toBe(1)
  }, 60_000)

  it('negócio genérico (não recrutamento) fecha marcando ganho, sem criar job_opening', async () => {
    if (apiKey) process.env.OPENAI_API_KEY = apiKey

    const unit: Unit = {
      id: 'unit-2',
      org_id: 'org-1',
      name: 'Unidade Teste Genérica',
      slug: 'unidade-teste-generica',
      whatsapp_instance_id: null,
      whatsapp_phone: '5511999999998',
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
      is_active: true,
      created_at: '',
      updated_at: '',
    }

    const sdrConfig: AgentConfig = {
      id: 'cfg-sdr-2',
      unit_id: unit.id,
      agent_type: 'sdr',
      persona_name: 'Kai',
      persona_tone: 'friendly',
      daily_limit: 50,
      active_hours: { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] },
      escalation_rules: { after_messages: 999, keywords: [] },
      sectors: [],
      is_active: true,
      business_profile: {
        sobre_a_empresa: 'Empresa de manutenção de ar-condicionado para clínicas e escritórios.',
        produtos: [{ nome: 'Contrato de manutenção mensal', preco: 'R$ 450/mês' }],
        fechamento: 'fecha_sozinho',
        fechamento_cria_vaga_recrutamento: false,
        fechamento_acao: 'Só registrar o interesse e notificar o time comercial humano pra fechar por telefone.',
      },
      interview_status: 'completed',
      interview_transcript: [],
      created_at: '',
      updated_at: '',
    }

    const lead: Lead = {
      id: 'lead-2',
      unit_id: unit.id,
      company_name: 'Clínica Vida Plena',
      contact_name: 'Renata',
      phone: '5511988887776',
      email: null,
      sector: 'saude',
      city: null,
      state: null,
      source: 'google_maps',
      status: 'replied',
      google_place_id: null,
      notes: null,
      last_contacted_at: new Date().toISOString(),
      deal_profile: {},
      deal_closed_at: null,
      smarter_crm_lead_id: null,
      created_at: '',
      updated_at: '',
    }

    const { supabase, db } = createFakeSupabase({
      agent_configs: [sdrConfig as unknown as Record<string, unknown>],
      leads: [lead as unknown as Record<string, unknown>],
    })

    const { processInboundMessage } = await import('@/lib/conversation-engine')

    const incomingText = 'Fechado, pode seguir com o contrato de manutenção mensal para a nossa clínica!'

    const result = await processInboundMessage({ supabase, unit, lead, incomingText })

    expect(result.dealHandoffReady).toBe(true)

    const updatedLead = db.leads?.find((row) => row.id === lead.id) as unknown as Lead
    expect(updatedLead.status).toBe('won')
    expect(updatedLead.deal_closed_at).toBeTruthy()

    const { handleSalesDealHandoff } = await import('@/lib/sales/deal-handoff')
    await handleSalesDealHandoff(supabase, { leadId: lead.id, unit })

    // Não deve tentar criar vaga nenhuma — não faz sentido pra esse negócio.
    const jobs = (db.job_openings ?? []) as unknown as JobOpening[]
    expect(jobs).toHaveLength(0)

    // Idempotência: fechar de novo não gera vaga nem quebra.
    await handleSalesDealHandoff(supabase, { leadId: lead.id, unit })
    expect((db.job_openings ?? []).length).toBe(0)
  }, 60_000)
})
