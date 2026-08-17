import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { Unit } from '@/lib/types'

// Pedido do Vinicius (2026-08-06): a Recepcionista não via mensagens que um
// humano da equipe manda direto pelo WhatsApp conectado pra intervir numa
// conversa — o webhook descartava QUALQUER mensagem `key.fromMe=true` sem
// distinguir eco do próprio envio automático de uma intervenção manual real.
// Sem isso, a próxima resposta da IA repetia "ainda estou verificando" mesmo
// depois de o humano já ter resolvido o assunto na conversa. Este teste
// exercita o handler HTTP de verdade (route.ts) com uma instância dedicada
// da Recepcionista (migration 051) e confirma: (1) mensagem `fromMe` que é
// eco do próprio envio automático continua descartada; (2) mensagem `fromMe`
// que é uma intervenção manual real é gravada como outbound normal, sem
// disparar sendMessage nem o pipeline de IA.

const sendWhatsAppMessage = vi.fn(async () => ({ ok: true }))
const generateChatReply = vi.fn(async () => 'não deveria ser chamado')
const generateStructuredReply = vi.fn(async () => ({}))

function buildUnit(): Unit {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Matriz',
    slug: 'matriz',
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
    evolution_instance_name: 'test-instance-receptionist',
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

function mockEvolutionModule(unit: Unit) {
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
    resolveWhatsappChannel: vi.fn(async () => null),
    getBase64FromMediaMessage: vi.fn(),
    syncWhatsappPhoneIfConnected: vi.fn(async () => {}),
    sendWhatsAppMessage,
    sendTypingPresence: vi.fn(async () => ({ ok: true })),
    sendRecordingPresence: vi.fn(async () => ({ ok: true })),
    sendWhatsAppAudio: vi.fn(async () => ({ ok: true })),
    sendWhatsAppDocument: vi.fn(async () => ({ ok: true })),
  }))
}

function buildFromMePayload(messageId: string, text: string) {
  return {
    instance: 'test-instance-receptionist',
    data: {
      key: {
        id: messageId,
        remoteJid: '5511987650000@s.whatsapp.net',
        fromMe: true,
      },
      message: { conversation: text },
    },
  }
}

describe('POST /api/webhooks/whatsapp — mensagem fromMe na instância da Recepcionista', () => {
  beforeEach(() => {
    vi.resetModules()
    sendWhatsAppMessage.mockClear()
    generateChatReply.mockClear()
    generateStructuredReply.mockClear()
  })

  it('mensagem fromMe que é intervenção humana real (não eco) é gravada como outbound, sem enviar nem gerar resposta de IA', async () => {
    const unit = buildUnit()
    const { supabase, db } = createFakeSupabase({
      units: [unit as unknown as Record<string, unknown>],
      customers: [
        {
          id: 'customer-1',
          org_id: unit.org_id,
          unit_id: unit.id,
          lead_id: null,
          name: 'Cliente Teste',
          phone: '5511987650000',
          email: null,
          status: 'active',
          tags: [],
          source: 'manual',
        } as unknown as Record<string, unknown>,
      ],
    })

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    mockEvolutionModule(unit)
    vi.doMock('@/lib/openai', () => ({
      getOpenAIApiKey: () => 'fake-key',
      generateChatReply,
      generateStructuredReply,
      transcribeAudio: vi.fn(),
      synthesizeSpeech: vi.fn(),
    }))

    const { POST } = await import('../route')

    const payload = buildFromMePayload('OP-MSG-1', 'Já resolvi isso aqui com o cliente, pode fechar.')
    const response = await POST(
      new Request('http://localhost/api/webhooks/whatsapp', { method: 'POST', body: JSON.stringify(payload) }),
    )
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(generateChatReply).not.toHaveBeenCalled()
    expect(generateStructuredReply).not.toHaveBeenCalled()

    const outboundRows = (db.customer_messages ?? []).filter(
      (row) => row.customer_id === 'customer-1' && row.direction === 'outbound',
    )
    expect(outboundRows).toHaveLength(1)
    expect(outboundRows[0]?.content).toBe('Já resolvi isso aqui com o cliente, pode fechar.')
    expect(outboundRows[0]?.status).toBe('sent')
  })

  it('mensagem fromMe que é eco de um envio automático recente continua descartada, sem gravar nada', async () => {
    const unit = buildUnit()
    const echoText = 'Prontinho! Já deixei confirmado, qualquer coisa me chama por aqui.'
    const { supabase, db } = createFakeSupabase({
      units: [unit as unknown as Record<string, unknown>],
      customers: [
        {
          id: 'customer-1',
          org_id: unit.org_id,
          unit_id: unit.id,
          lead_id: null,
          name: 'Cliente Teste',
          phone: '5511987650000',
          email: null,
          status: 'active',
          tags: [],
          source: 'manual',
        } as unknown as Record<string, unknown>,
      ],
      customer_messages: [
        {
          id: 'msg-outbound-auto',
          customer_id: 'customer-1',
          unit_id: unit.id,
          channel: 'whatsapp',
          direction: 'outbound',
          content: echoText,
          status: 'sent',
          sent_at: new Date().toISOString(),
        },
      ],
    })

    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    mockEvolutionModule(unit)
    vi.doMock('@/lib/openai', () => ({
      getOpenAIApiKey: () => 'fake-key',
      generateChatReply,
      generateStructuredReply,
      transcribeAudio: vi.fn(),
      synthesizeSpeech: vi.fn(),
    }))

    const { POST } = await import('../route')

    const payload = buildFromMePayload('OP-MSG-ECHO-1', echoText)
    const response = await POST(
      new Request('http://localhost/api/webhooks/whatsapp', { method: 'POST', body: JSON.stringify(payload) }),
    )
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()

    const outboundRows = (db.customer_messages ?? []).filter((row) => row.direction === 'outbound')
    expect(outboundRows).toHaveLength(1) // só a que já existia antes (seed) — nada novo gravado
  })
})
