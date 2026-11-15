import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { Unit } from '@/lib/types'

const routeInboundMessage = vi.fn(async () => ({ ok: true }))
const validateRequest = vi.fn(() => true)

function unit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit-1', org_id: 'org-1', name: 'Unidade SMS', slug: 'unidade-sms',
    twilio_phone_number: '+15551234567', twilio_auth_token: null,
    is_active: true, created_at: '', updated_at: '',
    ...overrides,
  } as Unit
}

function request(headers: Record<string, string> = {}) {
  return new Request('https://www.alizoai.com/api/webhooks/sms', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({
      From: '+15557654321', To: '+15551234567', Body: 'Preciso de ajuda', MessageSid: 'SM123',
    }),
  })
}

describe('POST /api/webhooks/sms', () => {
  const originalToken = process.env.TWILIO_AUTH_TOKEN

  beforeEach(() => {
    vi.resetModules()
    routeInboundMessage.mockClear()
    validateRequest.mockClear()
    validateRequest.mockReturnValue(true)
    delete process.env.TWILIO_AUTH_TOKEN
    vi.doMock('twilio', () => ({ default: { validateRequest } }))
    vi.doMock('@/lib/inbound-router', async (importOriginal) => {
      const original = await importOriginal<Record<string, unknown>>()
      return { ...original, routeInboundMessage }
    })
  })

  afterEach(() => {
    process.env.TWILIO_AUTH_TOKEN = originalToken
    vi.restoreAllMocks()
  })

  it('falha fechado quando token ou assinatura estão ausentes', async () => {
    const { supabase } = createFakeSupabase({ units: [unit()], system_events: [] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    const { POST } = await import('../route')

    const response = await POST(request())

    expect(response.status).toBe(503)
    expect(routeInboundMessage).not.toHaveBeenCalled()
  })

  it('aceita assinatura Twilio válida e encaminha ao motor central', async () => {
    const { supabase } = createFakeSupabase({ units: [unit({ twilio_auth_token: 'token-seguro' })], system_events: [] })
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => supabase }))
    const { POST } = await import('../route')

    const response = await POST(request({ 'x-twilio-signature': 'assinatura-valida' }))

    expect(response.status).toBe(200)
    expect(validateRequest).toHaveBeenCalledTimes(1)
    expect(routeInboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      unit: expect.objectContaining({ id: 'unit-1' }),
      channel: 'sms',
      incomingPhone: '15557654321',
      text: 'Preciso de ajuda',
      externalMessageId: 'SM123',
    }))
  })
})
