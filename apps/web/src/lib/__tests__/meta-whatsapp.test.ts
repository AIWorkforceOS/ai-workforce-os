import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMetaWhatsappConfig, sendMetaWhatsappText } from '@/lib/meta-whatsapp'
import { getMessagingChannel } from '@/lib/channels/messaging-channel'
import type { Unit } from '@/lib/types'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Meta WhatsApp Cloud API', () => {
  it('só ativa o canal depois de a unidade estar oficialmente validada', () => {
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', 'secret-token')
    const unit = {
      whatsapp_connection_mode: 'official_requested',
      meta_whatsapp_phone_number_id: 'phone-id',
    } as Unit
    expect(getMetaWhatsappConfig(unit)).toBeNull()

    unit.whatsapp_connection_mode = 'official'
    expect(getMetaWhatsappConfig(unit)).toEqual({
      accessToken: 'secret-token',
      phoneNumberId: 'phone-id',
      wabaId: null,
    })
  })

  it('envia texto pelo phone_number_id sem expor o token no payload', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] })))
    vi.stubGlobal('fetch', fetchMock)

    await sendMetaWhatsappText(
      { accessToken: 'secret-token', phoneNumberId: '12345', wabaId: '67890' },
      '+55 (21) 99999-0000',
      'Olá!',
    )

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/12345/messages')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-token' })
    expect(JSON.parse(String(init.body))).toMatchObject({ to: '5521999990000', text: { body: 'Olá!' } })
    expect(String(init.body)).not.toContain('secret-token')
  })

  it('mantém uma instância Evolution dedicada enquanto o número compartilhado usa a Meta', () => {
    vi.stubEnv('META_WHATSAPP_ACCESS_TOKEN', 'secret-token')
    const unit = {
      whatsapp_connection_mode: 'official',
      meta_whatsapp_phone_number_id: 'phone-id',
      evolution_instance_name: 'shared-instance',
    } as Unit

    const shared = getMessagingChannel(unit, null, {
      apiUrl: 'https://evolution.test', apiKey: 'key', instanceName: 'shared-instance',
    })
    const dedicated = getMessagingChannel(unit, null, {
      apiUrl: 'https://evolution.test', apiKey: 'key', instanceName: 'sales-instance',
    })

    expect(shared?.constructor.name).toBe('MetaWhatsAppChannel')
    expect(dedicated?.constructor.name).toBe('EvolutionWhatsAppChannel')
  })
})
