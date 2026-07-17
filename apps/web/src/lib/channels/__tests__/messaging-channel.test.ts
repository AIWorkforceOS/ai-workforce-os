import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getMessagingChannel,
  getUnitChannelType,
  getEmailChannel,
  sendToLeadChannels,
  channelLabel,
} from '@/lib/channels/messaging-channel'
import { smsSegmentCount, truncateForSms } from '@/lib/twilio'
import { sendLeadEmail } from '@/lib/email'
import type * as EmailModule from '@/lib/email'
import type { Unit } from '@/lib/types'

// Cobre a lógica de seleção de canal (item 2 do pedido: cada unidade
// escolhe WhatsApp ou SMS, e o canal escolhido só "funciona" quando as
// credenciais daquele provider específico estão presentes — nunca cai
// silenciosamente para o outro canal), o e-mail como canal ADICIONAL
// (item 1: tentado sempre que o lead tem e-mail, em paralelo ao
// telefone — nunca no lugar dele) e a lógica de segmentação/truncamento
// de SMS (nota técnica do pedido: 160 caracteres por segmento, custo
// proporcional).

vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof EmailModule>()
  return { ...actual, sendLeadEmail: vi.fn(async () => ({ ok: true })) }
})

vi.mock('@/lib/evolution', () => ({
  getEvolutionConfig: (unit: Unit) =>
    unit.evolution_api_url && unit.evolution_api_key
      ? { apiUrl: unit.evolution_api_url, apiKey: unit.evolution_api_key, instanceName: 'fake' }
      : null,
  sendWhatsAppMessage: vi.fn(async () => ({ ok: true })),
}))

function makeUnit(overrides: Partial<Unit> = {}): Unit {
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
    region_city: null,
    region_state: null,
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
      public_lead_intake_token: null,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('getUnitChannelType', () => {
  it('defaults to whatsapp when messaging_channel is null (unidades já em produção)', () => {
    expect(getUnitChannelType(makeUnit())).toBe('whatsapp')
  })

  it('respeita a escolha explícita de sms', () => {
    expect(getUnitChannelType(makeUnit({ messaging_channel: 'sms' }))).toBe('sms')
  })
})

describe('getMessagingChannel', () => {
  it('retorna null quando o canal é whatsapp mas a Evolution API não está configurada', () => {
    expect(getMessagingChannel(makeUnit())).toBeNull()
  })

  it('retorna um canal WhatsApp quando as credenciais Evolution existem', () => {
    const channel = getMessagingChannel(
      makeUnit({ evolution_api_url: 'https://evo.test', evolution_api_key: 'key' }),
    )
    expect(channel?.type).toBe('whatsapp')
  })

  it('retorna null quando o canal é sms mas a Twilio não está configurada', () => {
    expect(getMessagingChannel(makeUnit({ messaging_channel: 'sms' }))).toBeNull()
  })

  it('retorna um canal SMS quando as credenciais Twilio existem', () => {
    const channel = getMessagingChannel(
      makeUnit({
        messaging_channel: 'sms',
        twilio_account_sid: 'ACxxx',
        twilio_auth_token: 'token',
        twilio_phone_number: '+15551234567',
      }),
    )
    expect(channel?.type).toBe('sms')
  })

  it('não cai para WhatsApp quando sms foi escolhido mas não configurado, mesmo com Evolution disponível', () => {
    const unit = makeUnit({
      messaging_channel: 'sms',
      evolution_api_url: 'https://evo.test',
      evolution_api_key: 'key',
    })
    expect(getMessagingChannel(unit)).toBeNull()
  })
})

describe('smsSegmentCount', () => {
  it('conta 1 segmento para mensagem curta em ascii', () => {
    expect(smsSegmentCount('Oi, tudo bem?')).toBe(1)
  })

  it('conta múltiplos segmentos acima de 160 caracteres ascii', () => {
    expect(smsSegmentCount('a'.repeat(200))).toBe(2)
  })

  it('usa o limite unicode (70) quando há emoji/acentuação', () => {
    expect(smsSegmentCount('á'.repeat(100))).toBeGreaterThan(1)
  })
})

describe('truncateForSms', () => {
  it('trunca respostas muito longas com reticências', () => {
    const long = 'a'.repeat(1000)
    const truncated = truncateForSms(long)
    expect(truncated.length).toBeLessThan(long.length)
    expect(truncated.endsWith('…')).toBe(true)
  })

  it('não altera mensagens curtas', () => {
    expect(truncateForSms('mensagem curta')).toBe('mensagem curta')
  })
})

describe('getEmailChannel', () => {
  const originalKey = process.env.RESEND_API_KEY
  const originalDomain = process.env.EMAIL_FROM_DOMAIN

  afterEach(() => {
    process.env.RESEND_API_KEY = originalKey
    process.env.EMAIL_FROM_DOMAIN = originalDomain
  })

  it('retorna null quando RESEND_API_KEY não está configurada', () => {
    delete process.env.RESEND_API_KEY
    process.env.EMAIL_FROM_DOMAIN = 'test.com'
    expect(getEmailChannel(makeUnit())).toBeNull()
  })

  it('retorna null quando EMAIL_FROM_DOMAIN não está configurada', () => {
    process.env.RESEND_API_KEY = 're_test'
    delete process.env.EMAIL_FROM_DOMAIN
    expect(getEmailChannel(makeUnit())).toBeNull()
  })

  it('retorna um canal de e-mail quando a plataforma tem Resend configurado', () => {
    process.env.RESEND_API_KEY = 're_test'
    process.env.EMAIL_FROM_DOMAIN = 'test.com'
    expect(getEmailChannel(makeUnit())?.type).toBe('email')
  })
})

describe('sendToLeadChannels — e-mail é sempre adicional ao telefone, nunca substitui', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test'
    process.env.EMAIL_FROM_DOMAIN = 'test.com'
    vi.clearAllMocks()
  })

  it('tenta só e-mail quando o lead não tem telefone', async () => {
    const attempts = await sendToLeadChannels({
      unit: makeUnit(),
      lead: { phone: null, email: 'lead@empresa.com' },
      text: 'Olá!',
    })
    expect(attempts).toEqual([{ channel: 'email', ok: true }])
    expect(sendLeadEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'lead@empresa.com', bodyText: 'Olá!' }),
    )
  })

  it('tenta WhatsApp e e-mail juntos quando o lead tem os dois e ambos estão configurados', async () => {
    const unit = makeUnit({ evolution_api_url: 'https://evo.test', evolution_api_key: 'key' })
    const attempts = await sendToLeadChannels({
      unit,
      lead: { phone: '5511999999999', email: 'lead@empresa.com' },
      text: 'Olá!',
    })
    expect(attempts.map((a) => a.channel).sort()).toEqual(['email', 'whatsapp'])
    expect(attempts.every((a) => a.ok)).toBe(true)
  })

  it('não tenta nenhum canal quando o lead não tem telefone nem e-mail', async () => {
    const attempts = await sendToLeadChannels({
      unit: makeUnit(),
      lead: { phone: null, email: null },
      text: 'Olá!',
    })
    expect(attempts).toEqual([])
  })

  it('não tenta e-mail quando o lead tem e-mail mas a plataforma não tem Resend configurado', async () => {
    delete process.env.RESEND_API_KEY
    const attempts = await sendToLeadChannels({
      unit: makeUnit(),
      lead: { phone: null, email: 'lead@empresa.com' },
      text: 'Olá!',
    })
    expect(attempts).toEqual([])
  })
})

describe('channelLabel', () => {
  it('rotula email como E-mail', () => {
    expect(channelLabel('email')).toBe('E-mail')
  })
})
