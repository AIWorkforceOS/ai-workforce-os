import { describe, expect, it, vi } from 'vitest'
import { buildBalanceView, groupUsageByEndpoint, OPENAI_BILLING_URL } from '../consumption'

describe('saldo da OpenAI (nunca inventado)', () => {
  it('sem chave administrativa: "Saldo indisponível" com link oficial', async () => {
    const v = await buildBalanceView({})
    expect(v).toMatchObject({ kind: 'unavailable', billing_url: OPENAI_BILLING_URL })
    expect((v as { reason: string }).reason).toMatch(/indisponível/i)
  })
  it('com chave mas sem crédito informado: continua indisponível (explica como estimar)', async () => {
    const v = await buildBalanceView({ OPENAI_ADMIN_KEY: 'k' })
    expect(v.kind).toBe('unavailable')
    expect((v as { reason: string }).reason).toMatch(/OPENAI_PREPAID_LOADED_USD/)
  })
  it('com crédito informado + custo real: ESTIMATIVA rotulada, com alerta de crédito baixo', async () => {
    const fetchCost = vi.fn().mockResolvedValue({ amountUsd: 85, from: '', to: '' })
    const v = await buildBalanceView({ OPENAI_ADMIN_KEY: 'k', OPENAI_PREPAID_LOADED_USD: '100', OPENAI_PREPAID_LOADED_AT: '2026-10-01T00:00:00Z' }, fetchCost)
    expect(v).toMatchObject({ kind: 'estimate', loaded_usd: 100, spent_since_usd: 85, remaining_usd: 15, low: true })
    expect(fetchCost).toHaveBeenCalledWith({ from: new Date('2026-10-01T00:00:00Z') })
  })
  it('falha ao ler o custo real: indisponível (não chuta)', async () => {
    const v = await buildBalanceView({ OPENAI_ADMIN_KEY: 'k', OPENAI_PREPAID_LOADED_USD: '100', OPENAI_PREPAID_LOADED_AT: '2026-10-01T00:00:00Z' }, vi.fn().mockResolvedValue(null))
    expect(v.kind).toBe('unavailable')
  })
})

describe('groupUsageByEndpoint', () => {
  it('soma por agente/etapa e ordena pelo custo', () => {
    const rows = [
      { endpoint: 'quote-agent:diagnosis', request_count: 1, total_tokens: 3000, estimated_cost_usd: 0.002 },
      { endpoint: 'quote-agent:diagnosis', request_count: 1, total_tokens: 2000, estimated_cost_usd: 0.001 },
      { endpoint: 'receptionist', request_count: 5, total_tokens: 9000, estimated_cost_usd: 0.05 },
    ]
    expect(groupUsageByEndpoint(rows)).toEqual([
      { endpoint: 'receptionist', requests: 5, tokens: 9000, estimated_usd: 0.05 },
      { endpoint: 'quote-agent:diagnosis', requests: 2, tokens: 5000, estimated_usd: expect.closeTo(0.003, 6) },
    ])
  })
})
