import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { localDateString } from '@/lib/slot-engine'
import type { Unit } from '@/lib/types'

// Bug real (regressão do commit 5924ad9, investigado direto em produção):
// alguém que escreve pela primeira vez na instância WhatsApp DEDICADA da
// Recepcionista (migration 051, unit_whatsapp_channels agent_type=
// 'receptionist') e ainda não é cliente cadastrado precisa ser atendido —
// inclusive conseguir marcar um serviço — sem que a IA peça pra ela "se
// cadastrar" antes. Este teste exercita o handler HTTP de verdade
// (route.ts) com um payload real de mensagem de número desconhecido pedindo
// um agendamento, e confirma ponta a ponta: a mensagem é roteada direto pro
// motor da Recepcionista (nunca cai na triagem genérica de número
// desconhecido, que existia pro número compartilhado do Sales Rep), o
// cadastro do cliente é criado pela própria IA (não pedido à pessoa), o
// agendamento é gravado de verdade, e o texto de sistema mandado ao modelo
// proíbe explicitamente pedir cadastro à pessoa.

const sendWhatsAppMessage = vi.fn(async () => ({ ok: true }))
let capturedReplySystemPrompt = ''
const generateChatReply = vi.fn(async ({ systemPrompt }: { systemPrompt: string }) => {
  capturedReplySystemPrompt = systemPrompt
  return 'Prontinho! Já deixei seu Corte de Cabelo marcado — qualquer coisa me chama por aqui.'
})
const generateStructuredReply = vi.fn(async ({ systemPrompt }: { systemPrompt: string }) => {
  // Extrator de intenção do prospecto (ver buildProspectIntentExtractorPrompt) —
  // identificado pelo campo "appointment_action" que só esse prompt pede.
  if (systemPrompt.includes('appointment_action')) {
    return {
      handoff: 'none',
      handoff_reason: null,
      appointment_action: 'book',
      service_name: 'Corte de Cabelo',
      desired_date: bookableDateStr,
      desired_time: '14:00',
    }
  }
  return {}
})

/** Primeiro dia útil (seg-sex) a partir de 3 dias no futuro — longe o bastante do min_notice_minutes (2h) e dentro do max_advance_days (60) padrão, sem depender de uma data fixa que expira. */
function pickBookableDateStr(timezone: string): string {
  const weekdayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  for (let addDays = 3; addDays < 25; addDays += 1) {
    const d = new Date(Date.now() + addDays * 24 * 60 * 60 * 1000)
    const wd = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone }).format(d)
    const key = weekdayKeys.find((k) => wd.toLowerCase().startsWith(k.slice(0, 3)))
    if (key && !['sun', 'sat'].includes(key)) return localDateString(d, timezone)
  }
  throw new Error('não achou dia útil')
}

const bookableDateStr = pickBookableDateStr('America/Sao_Paulo')

function buildUnit(): Unit {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Unidade Teste',
    slug: 'unidade-teste',
    whatsapp_instance_id: null,
    whatsapp_phone: null,
    email_from: null,
    email_reply_to: null,
    logo_url: null,
    email_accent_color: null,
    email_footer_note: null,
    region_city: null,
    region_state: null,
    evolution_api_url: 'https://fake-evolution.test',
    evolution_api_key: 'fake-key',
    evolution_instance_name: 'test-instance',
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
  } as unknown as Unit
}

function buildEvolutionPayload(messageId: string, text: string) {
  return {
    instance: 'test-instance-receptionist',
    data: {
      key: {
        id: messageId,
        remoteJid: '5511987650000@s.whatsapp.net',
        fromMe: false,
      },
      message: { conversation: text },
    },
  }
}

describe('POST /api/webhooks/whatsapp — canal dedicado da Recepcionista, número desconhecido', () => {
  beforeEach(() => {
    vi.resetModules()
    sendWhatsAppMessage.mockClear()
    generateChatReply.mockClear()
    generateStructuredReply.mockClear()
    capturedReplySystemPrompt = ''
  })

  it('pede agendamento sem ser cliente cadastrado: é atendida, agendada e o cadastro é criado pela própria IA — nunca pedido à pessoa', async () => {
    const unit = buildUnit()
    const { supabase, db } = createFakeSupabase({
      units: [unit as unknown as Record<string, unknown>],
      unit_whatsapp_channels: [
        {
          unit_id: unit.id,
          agent_type: 'receptionist',
          evolution_instance_name: 'test-instance-receptionist',
          whatsapp_phone: '5511988887777',
        } as unknown as Record<string, unknown>,
      ],
      agent_configs: [
        {
          id: 'agent-config-1',
          unit_id: unit.id,
          agent_type: 'receptionist',
          is_active: true,
          persona_name: 'Ana',
          persona_tone: 'friendly',
        } as unknown as Record<string, unknown>,
      ],
      services: [
        {
          id: 'service-1',
          org_id: unit.org_id,
          unit_id: unit.id,
          name: 'Corte de Cabelo',
          duration_minutes: 60,
          buffer_minutes: 0,
          capacity_per_slot: 1,
          price: 80,
          is_active: true,
        } as unknown as Record<string, unknown>,
      ],
    })

    vi.doMock('@/lib/supabase/service', () => ({
      createServiceClient: () => supabase,
    }))
    vi.doMock('@/lib/evolution', () => ({
      getEvolutionConfig: () => ({ apiUrl: 'https://fake-evolution.test', apiKey: 'fake', instanceName: 'test-instance-receptionist' }),
      resolveWhatsappChannelByInstanceName: vi.fn(async () => ({
        unit,
        agentType: 'receptionist',
        channel: {
          agentType: 'receptionist',
          config: { apiUrl: 'https://fake-evolution.test', apiKey: 'fake', instanceName: 'test-instance-receptionist' },
          whatsappPhone: '5511988887777',
          persistPhone: vi.fn(async () => {}),
        },
      })),
      resolveWhatsappChannel: vi.fn(async () => ({
        agentType: 'receptionist',
        config: { apiUrl: 'https://fake-evolution.test', apiKey: 'fake', instanceName: 'test-instance-receptionist' },
        whatsappPhone: '5511988887777',
        persistPhone: vi.fn(async () => {}),
      })),
      getBase64FromMediaMessage: vi.fn(),
      syncWhatsappPhoneIfConnected: vi.fn(async () => {}),
      sendWhatsAppMessage,
      sendTypingPresence: vi.fn(async () => ({ ok: true })),
      sendRecordingPresence: vi.fn(async () => ({ ok: true })),
      sendWhatsAppAudio: vi.fn(async () => ({ ok: true })),
      sendWhatsAppDocument: vi.fn(async () => ({ ok: true })),
    }))
    vi.doMock('@/lib/openai', () => ({
      getOpenAIApiKey: () => 'fake-key',
      generateChatReply,
      generateStructuredReply,
      transcribeAudio: vi.fn(),
      synthesizeSpeech: vi.fn(),
    }))

    const { POST } = await import('../route')

    const payload = buildEvolutionPayload('MSG-PROSPECT-1', 'Oi! Queria marcar um Corte de Cabelo, pode ser às 14h?')
    const response = await POST(
      new Request('http://localhost/api/webhooks/whatsapp', { method: 'POST', body: JSON.stringify(payload) }),
    )
    const body = await response.json()

    expect(body).toMatchObject({ ok: true, routed: 'receptionist_prospect', handled: true })

    // Respondeu de verdade, sem travar pedindo nada — e nunca através da
    // triagem genérica de número desconhecido (Rota 3), que é só pro
    // número compartilhado/instância do Sales Rep.
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1)

    // O cadastro foi criado pela própria IA (auto-provisionamento), nunca
    // pedido à pessoa — e só depois de ela pedir o agendamento de verdade.
    expect((db.customers ?? []).length).toBe(1)
    const customer = db.customers![0]!
    expect(customer.source).toBe('receptionist_self_service')
    expect(customer.phone).toBe('5511987650000')

    // O agendamento foi gravado de verdade (não é uma promessa vazia do modelo).
    expect((db.appointments ?? []).length).toBe(1)
    const appointment = db.appointments![0]!
    expect(appointment.customer_id).toBe(customer.id)
    expect(appointment.service_id).toBe('service-1')

    // O lead que identifica quem escreveu (Rota 3 do produto pra quem não
    // é cliente) também existe, e está linkado ao cliente promovido.
    expect((db.leads ?? []).length).toBe(1)
    expect(customer.lead_id).toBe(db.leads![0]!.id)

    // O texto de sistema mandado ao modelo proíbe explicitamente pedir
    // cadastro — a garantia de que o comportamento relatado (Ana pedindo
    // pra "se cadastrar") não pode mais acontecer por instrução de prompt.
    expect(capturedReplySystemPrompt).toMatch(/NUNCA peça para a pessoa.*se cadastrar/i)
    // E a resposta já vem ancorada no agendamento de verdade, não inventada.
    expect(capturedReplySystemPrompt).toContain('Agendamento confirmado: Corte de Cabelo')
  })
})
