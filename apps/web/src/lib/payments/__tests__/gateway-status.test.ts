import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { isPaymentPlatformConfigured, getPaymentProviderForRegion } from '../gateway-status'

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

describe('getPaymentProviderForRegion', () => {
  it('retorna null quando não há linha ativa pra região', async () => {
    const { supabase } = createFakeSupabase({ payment_gateway_settings: [] })
    expect(await getPaymentProviderForRegion(supabase, 'BR')).toBeNull()
  })

  it('retorna null quando a linha ativa não tem a credencial esperada pelo provider', async () => {
    const { supabase } = createFakeSupabase({
      payment_gateway_settings: [{ region: 'BR', provider: 'asaas', credentials: {}, is_active: true }],
    })
    expect(await getPaymentProviderForRegion(supabase, 'BR')).toBeNull()
  })

  it('instancia o AsaasProvider quando região BR tem asaas ativo com api_key', async () => {
    const { supabase } = createFakeSupabase({
      payment_gateway_settings: [
        { region: 'BR', provider: 'asaas', credentials: { api_key: 'abc' }, is_active: true },
      ],
    })
    const provider = await getPaymentProviderForRegion(supabase, 'BR')
    expect(provider?.id).toBe('asaas')
  })

  it('instancia o StripeProvider quando região US tem stripe ativo com secret_key', async () => {
    const { supabase } = createFakeSupabase({
      payment_gateway_settings: [
        { region: 'US', provider: 'stripe', credentials: { secret_key: 'sk_live_x' }, is_active: true },
      ],
    })
    const provider = await getPaymentProviderForRegion(supabase, 'US')
    expect(provider?.id).toBe('stripe')
  })

  it('provider desconhecido (ex.: mercado_pago, sem implementação) não quebra — só retorna null', async () => {
    const { supabase } = createFakeSupabase({
      payment_gateway_settings: [
        { region: 'BR', provider: 'mercado_pago', credentials: { access_token: 'x' }, is_active: true },
      ],
    })
    expect(await getPaymentProviderForRegion(supabase, 'BR')).toBeNull()
  })
})
