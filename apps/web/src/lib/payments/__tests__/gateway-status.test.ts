import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { isPaymentPlatformConfigured } from '../gateway-status'

describe('isPaymentPlatformConfigured', () => {
  it('retorna false quando não há nenhuma linha para a região', async () => {
    const { supabase } = createFakeSupabase({ payment_gateway_settings: [] })
    expect(await isPaymentPlatformConfigured(supabase, 'BR')).toBe(false)
  })

  it('retorna false quando a linha existe mas está inativa', async () => {
    const { supabase } = createFakeSupabase({
      payment_gateway_settings: [
        { region: 'BR', provider: 'asaas', credentials: { api_key: 'abc' }, is_active: false },
      ],
    })
    expect(await isPaymentPlatformConfigured(supabase, 'BR')).toBe(false)
  })

  it('retorna false quando a linha está ativa mas sem credenciais preenchidas', async () => {
    const { supabase } = createFakeSupabase({
      payment_gateway_settings: [
        { region: 'BR', provider: 'asaas', credentials: {}, is_active: true },
      ],
    })
    expect(await isPaymentPlatformConfigured(supabase, 'BR')).toBe(false)
  })

  it('retorna true quando existe linha ativa com credenciais preenchidas para a região', async () => {
    const { supabase } = createFakeSupabase({
      payment_gateway_settings: [
        { region: 'BR', provider: 'asaas', credentials: { api_key: 'abc' }, is_active: true },
      ],
    })
    expect(await isPaymentPlatformConfigured(supabase, 'BR')).toBe(true)
  })

  it('cada região tem sua própria checagem — BR configurado não libera US', async () => {
    const { supabase } = createFakeSupabase({
      payment_gateway_settings: [
        { region: 'BR', provider: 'asaas', credentials: { api_key: 'abc' }, is_active: true },
      ],
    })
    expect(await isPaymentPlatformConfigured(supabase, 'BR')).toBe(true)
    expect(await isPaymentPlatformConfigured(supabase, 'US')).toBe(false)
  })
})
