import { describe, expect, it } from 'vitest'
import { getMessagingChannel, getUnitChannelType } from '@/lib/channels/messaging-channel'
import { smsSegmentCount, truncateForSms } from '@/lib/twilio'
import type { Unit } from '@/lib/types'

// Cobre a lógica de seleção de canal (item 2 do pedido: cada unidade
// escolhe WhatsApp ou SMS, e o canal escolhido só "funciona" quando as
// credenciais daquele provider específico estão presentes — nunca cai
// silenciosamente para o outro canal) e a lógica de segmentação/
// truncamento de SMS (nota técnica do pedido: 160 caracteres por
// segmento, custo proporcional).

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
    region_city: null,
    region_state: null,
    evolution_api_url: null,
    evolution_api_key: null,
    evolution_instance_name: null,
    messaging_channel: null,
    twilio_account_sid: null,
    twilio_auth_token: null,
    twilio_phone_number: null,
    intake_token: null,
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
