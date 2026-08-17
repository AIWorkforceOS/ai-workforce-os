import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { Unit } from '@/lib/types'

const sendTechnicalAlertEmailMock = vi.fn(
  async (_params: { to: string; unitName: string; problem: string; impact: string }) => ({ ok: true }),
)
vi.mock('@/lib/email', () => ({
  sendTechnicalAlertEmail: (params: { to: string; unitName: string; problem: string; impact: string }) =>
    sendTechnicalAlertEmailMock(params),
}))

const buildAccountContextMock = vi.fn(async (_supabase: unknown, _orgId?: string | null) => 'CONTEXTO REAL DA CONTA DO CLIENTE LOGADO: Unidades (1):\n- Matriz: WhatsApp conectado.')
vi.mock('@/lib/chat/account-context', () => ({
  buildAccountContext: (supabase: unknown, orgId?: string | null) => buildAccountContextMock(supabase, orgId),
}))

let classification: { kind: 'guidance' | 'error_report'; reported_problem: string } = {
  kind: 'guidance',
  reported_problem: 'Cliente não sabe conectar o WhatsApp.',
}

const GUIDANCE_ANSWER = 'Vá em Unidades > Conectar WhatsApp e escaneie o QR code com o celular da empresa.'
const HYPOTHESIS_TEXT = 'Hipótese: falha ao gerar QR code na Evolution API, sem evento correspondente registrado.'

vi.mock('@/lib/openai', () => ({
  getOpenAIApiKey: () => 'fake-key',
  generateStructuredReply: vi.fn(async () => classification),
  generateChatReply: vi.fn(async ({ systemPrompt }: { systemPrompt: string }) =>
    systemPrompt.includes('analisando um problema relatado') ? HYPOTHESIS_TEXT : GUIDANCE_ANSWER,
  ),
}))

// Duas regressões-alvo (pedido do produto 2026-08-06): o TI interno nunca
// executa ação nenhuma (só leitura + e-mail), e precisa devolver uma
// resposta pronta pro cliente — nunca só um resumo interno. Este arquivo
// cobre os dois modos de resposta (guidance/error_report) descritos no
// pedido.

function buildUnit(): Unit {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Matriz',
    slug: 'matriz',
    whatsapp_instance_id: null,
    whatsapp_phone: '5511999990000',
    email_from: null,
    email_reply_to: null,
    logo_url: null,
    email_accent_color: null,
    email_footer_note: null,
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
    timezone: 'America/Sao_Paulo',
    business_hours: {},
    scheduling_settings: {},
    billing_company_name: null,
    billing_address: null,
    billing_email: null,
    billing_phone: null,
    billing_payment_instructions: null,
    is_active: true,
    created_at: '',
    updated_at: '',
  }
}

describe('answerTechSupportQuestion — modo guidance', () => {
  beforeEach(() => {
    sendTechnicalAlertEmailMock.mockClear()
    buildAccountContextMock.mockClear()
    classification = { kind: 'guidance', reported_problem: 'Cliente não sabe conectar o WhatsApp.' }
  })

  it('retorna o texto de orientação pronto para o cliente, sem mandar e-mail nem registrar incidente', async () => {
    const unit = buildUnit()
    const { supabase, db } = createFakeSupabase({})

    const { answerTechSupportQuestion } = await import('@/lib/ti/engine')

    const result = await answerTechSupportQuestion(supabase, {
      unit,
      question: 'Como eu conecto o WhatsApp da minha unidade?',
    })

    expect(result.answer).toBe(GUIDANCE_ANSWER)
    expect(result.filedIncident).toBe(false)
    expect(sendTechnicalAlertEmailMock).not.toHaveBeenCalled()
    expect(buildAccountContextMock).toHaveBeenCalledWith(supabase, unit.org_id)

    const incidentEvents = (db.system_events ?? []).filter((row) => row.event_type === 'ti_incident_reported')
    expect(incidentEvents).toHaveLength(0)
  })
})

describe('answerTechSupportQuestion — modo error_report', () => {
  beforeEach(() => {
    sendTechnicalAlertEmailMock.mockClear()
    buildAccountContextMock.mockClear()
    classification = { kind: 'error_report', reported_problem: 'Apareceu "Internal Server Error" ao tentar gerar a fatura.' }
  })

  it('registra o incidente, manda o e-mail de alerta pro dono da org e devolve um reconhecimento com filedIncident true', async () => {
    const unit = buildUnit()
    const { supabase, db } = createFakeSupabase({
      organizations: [{ id: unit.org_id!, owner_email: 'dono@empresa.com' }],
    })

    const { answerTechSupportQuestion } = await import('@/lib/ti/engine')

    const result = await answerTechSupportQuestion(supabase, {
      unit,
      question: 'Deu erro ao gerar a fatura, apareceu Internal Server Error.',
    })

    expect(result.filedIncident).toBe(true)
    expect(result.answer.length).toBeGreaterThan(0)
    expect(result.answer).not.toBe(GUIDANCE_ANSWER)

    expect(sendTechnicalAlertEmailMock).toHaveBeenCalledTimes(1)
    const emailArgs = sendTechnicalAlertEmailMock.mock.calls[0]?.[0] as {
      to: string
      unitName: string
      problem: string
      impact: string
    }
    expect(emailArgs.to).toBe('dono@empresa.com')
    expect(emailArgs.unitName).toBe(unit.name)
    expect(emailArgs.problem).toContain('Internal Server Error')
    expect(emailArgs.impact).toContain(HYPOTHESIS_TEXT)

    const incidentEvents = (db.system_events ?? []).filter((row) => row.event_type === 'ti_incident_reported')
    expect(incidentEvents).toHaveLength(1)
    expect(incidentEvents[0]?.unit_id).toBe(unit.id)
  })
})
