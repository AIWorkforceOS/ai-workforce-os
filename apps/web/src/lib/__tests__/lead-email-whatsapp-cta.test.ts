import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendLeadEmail, buildWhatsappCtaHtml } from '@/lib/email'

// Item 2 do pedido de não-bloqueio do WhatsApp: o e-mail da prospecção fria
// (Google Maps) ganha um botão "Falar agora no WhatsApp" (link wa.me pro
// número da própria unidade, com mensagem pré-pronta que o LEAD manda por
// conta própria) — ver lib/leads/lead-intake.ts (buildWhatsappCta) e
// lib/channels/messaging-channel.ts (SendContext.whatsappCta).

describe('buildWhatsappCtaHtml', () => {
  it('monta o link wa.me com telefone só-dígitos e texto url-encoded', () => {
    const html = buildWhatsappCtaHtml({ phone: '+55 (11) 99999-9999', text: 'Olá! Recebi seu e-mail.' })
    expect(html).toContain('https://wa.me/5511999999999?text=')
    expect(html).toContain(encodeURIComponent('Olá! Recebi seu e-mail.'))
    expect(html).toContain('Falar agora no WhatsApp')
  })
})

describe('sendLeadEmail — botão de WhatsApp no template', () => {
  const originalDomain = process.env.EMAIL_FROM_DOMAIN
  const originalKey = process.env.RESEND_API_KEY

  beforeEach(() => {
    process.env.EMAIL_FROM_DOMAIN = 'test.com'
    process.env.RESEND_API_KEY = 're_test'
  })

  afterEach(() => {
    process.env.EMAIL_FROM_DOMAIN = originalDomain
    process.env.RESEND_API_KEY = originalKey
    vi.unstubAllGlobals()
  })

  it('inclui o botão de WhatsApp e avisa para não responder o e-mail quando whatsappCta é passado', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: { body?: string }) => ({
      ok: true,
      json: async () => ({ id: 'email_1' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await sendLeadEmail({
      to: 'lead@padaria.com',
      unitName: 'Padaria da Esquina',
      personaName: 'Kai',
      logoUrl: null,
      subject: 'Kai · Padaria da Esquina',
      bodyText: 'Olá! Vi que vocês têm uma padaria ótima.',
      whatsappCta: { phone: '5511999999999', text: 'Olá! Recebi o e-mail e quero saber mais.' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse((init as { body: string }).body)
    expect(body.html).toContain('https://wa.me/5511999999999')
    expect(body.html).toContain('Falar agora no WhatsApp')
    expect(body.html).toContain('não recebe respostas')
    expect(body.html).not.toContain('Basta responder este e-mail')
  })

  it('mantém o rodapé de "responda este e-mail" quando não há whatsappCta (comportamento anterior)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: { body?: string }) => ({
      ok: true,
      json: async () => ({ id: 'email_2' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await sendLeadEmail({
      to: 'lead@padaria.com',
      unitName: 'Padaria da Esquina',
      personaName: 'Kai',
      logoUrl: null,
      subject: 'Kai · Padaria da Esquina',
      bodyText: 'Olá! Tudo bem?',
    })

    const [, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse((init as { body: string }).body)
    expect(body.html).not.toContain('wa.me')
    expect(body.html).toContain('Basta responder este e-mail')
  })
})
