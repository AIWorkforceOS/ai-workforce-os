import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { Unit } from '@/lib/types'

// Testa o handler HTTP de verdade (route.ts), não só routeInboundMessage():
// reproduz o formato exato do payload da Evolution API e confirma que uma
// reentrega do MESMO webhook (mesmo data.key.id / external_message_id — o
// que a Evolution API faz via retryWebhookRequest quando nosso handler não
// responde 200 a tempo) não gera uma segunda resposta pro mesmo contato nem
// duplica a linha da conversa. Essa rajada de resposta duplicada é a causa
// raiz investigada do bloqueio do número de testes pela Meta.

const sendWhatsAppMessage = vi.fn(async () => ({ ok: true }))
const generateChatReply = vi.fn(
  async () => 'Oi! Você procura uma vaga, representa uma empresa que quer contratar, ou já é cliente?',
)

function buildUnit(): Unit {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Unidade Teste',
    slug: 'unidade-teste',
    whatsapp_instance_id: null,
    whatsapp_phone: '5511999999999',
    email_from: null,
    email_reply_to: null,
    logo_url: null,
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
  }
}

function buildEvolutionPayload(messageId: string) {
  return {
    instance: 'test-instance',
    data: {
      key: {
        id: messageId,
        remoteJid: '5511987654321@s.whatsapp.net',
        fromMe: false,
      },
      message: { conversation: 'Ola' },
    },
  }
}

describe('POST /api/webhooks/whatsapp — reentrega do provedor não duplica resposta', () => {
  beforeEach(() => {
    vi.resetModules()
    sendWhatsAppMessage.mockClear()
    generateChatReply.mockClear()
  })

  it('primeira entrega processa e responde normalmente; reentrega idêntica (mesmo external_message_id) não reprocessa nem manda segunda resposta', async () => {
    const { supabase } = createFakeSupabase({
      units: [buildUnit() as unknown as Record<string, unknown>],
    })

    vi.doMock('@/lib/supabase/service', () => ({
      createServiceClient: () => supabase,
    }))
    vi.doMock('@/lib/evolution', () => ({
      getEvolutionConfig: () => ({ apiUrl: 'https://fake-evolution.test', apiKey: 'fake', instanceName: 'test-instance' }),
      resolveWhatsappChannelByInstanceName: vi.fn(async () => ({
        unit: buildUnit(),
        agentType: null,
        channel: {
          agentType: null,
          config: { apiUrl: 'https://fake-evolution.test', apiKey: 'fake', instanceName: 'test-instance' },
          whatsappPhone: buildUnit().whatsapp_phone,
          persistPhone: vi.fn(async () => {}),
        },
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
      generateStructuredReply: vi.fn(async () => ({})),
      transcribeAudio: vi.fn(),
      synthesizeSpeech: vi.fn(),
    }))

    const { POST } = await import('../route')

    const payload = buildEvolutionPayload('MSG-DUPLICADO-1')
    const makeRequest = () =>
      new Request('http://localhost/api/webhooks/whatsapp', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

    // ── 1ª entrega: processa normalmente e manda a resposta ──────────
    const firstResponse = await POST(makeRequest())
    const firstBody = await firstResponse.json()
    expect(firstBody).toMatchObject({ ok: true, routed: 'unknown_inbound_screening' })
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1)

    const { data: conversationsAfterFirst } = await supabase
      .from('conversations')
      .select('*')
      .eq('external_message_id', 'MSG-DUPLICADO-1')
    expect((conversationsAfterFirst as unknown[]).length).toBe(1)

    const { data: leadsAfterFirst } = await supabase.from('leads').select('*')
    expect((leadsAfterFirst as unknown[]).length).toBe(1)

    // ── 2ª entrega: mesmo external_message_id (reentrega do provedor) ─
    const secondResponse = await POST(makeRequest())
    const secondBody = await secondResponse.json()
    expect(secondBody).toEqual({ ok: true, duplicate: true })

    // Não pode ter mandado uma segunda resposta pro mesmo contato.
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1)

    const { data: conversationsAfterSecond } = await supabase
      .from('conversations')
      .select('*')
      .eq('external_message_id', 'MSG-DUPLICADO-1')
    expect((conversationsAfterSecond as unknown[]).length).toBe(1)

    const { data: leadsAfterSecond } = await supabase.from('leads').select('*')
    expect((leadsAfterSecond as unknown[]).length).toBe(1)
  })
})
