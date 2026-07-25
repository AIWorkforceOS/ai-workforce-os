import { describe, expect, it } from 'vitest'
import { buildAudience, selectCustomerRecipients, selectLeadRecipients } from '../audience'
import type { AudienceCustomerRow, AudienceLeadRow } from '../types'

function lead(overrides: Partial<AudienceLeadRow> = {}): AudienceLeadRow {
  return {
    id: 'lead-1',
    email: 'lead@example.com',
    status: 'new',
    last_contacted_at: null,
    marketing_opt_out: false,
    unsubscribe_token: 'token-lead-1',
    ...overrides,
  }
}

function customer(overrides: Partial<AudienceCustomerRow> = {}): AudienceCustomerRow {
  return {
    id: 'cust-1',
    email: 'customer@example.com',
    status: 'active',
    marketing_opt_out: false,
    unsubscribe_token: 'token-cust-1',
    ...overrides,
  }
}

describe('selectLeadRecipients', () => {
  it('inclui lead com e-mail válido e sem opt-out', () => {
    const { included, skipped } = selectLeadRecipients([lead()], {})
    expect(included).toHaveLength(1)
    expect(included[0]).toMatchObject({ recipientType: 'lead', recipientId: 'lead-1', email: 'lead@example.com' })
    expect(skipped).toHaveLength(0)
  })

  it('pula lead com marketing_opt_out=true', () => {
    const { included, skipped } = selectLeadRecipients([lead({ marketing_opt_out: true })], {})
    expect(included).toHaveLength(0)
    expect(skipped).toEqual([
      { recipientType: 'lead', recipientId: 'lead-1', unsubscribeToken: 'token-lead-1', reason: 'skipped_opt_out' },
    ])
  })

  it('pula lead sem e-mail ou com e-mail inválido', () => {
    const { included, skipped } = selectLeadRecipients(
      [lead({ id: 'a', email: null }), lead({ id: 'b', email: 'nao-e-email' })],
      {},
    )
    expect(included).toHaveLength(0)
    expect(skipped.map((s) => s.reason)).toEqual(['skipped_no_email', 'skipped_no_email'])
  })

  it('filtra por status quando lead_statuses é informado — fora do segmento não conta como pulado', () => {
    const leads = [lead({ id: 'a', status: 'won' }), lead({ id: 'b', status: 'new' })]
    const { included, skipped } = selectLeadRecipients(leads, { lead_statuses: ['new'] })
    expect(included.map((r) => r.recipientId)).toEqual(['b'])
    expect(skipped).toHaveLength(0)
  })

  it('respeita stale_days: exclui contato recente, inclui nunca contatado ou contato antigo', () => {
    const now = new Date('2026-07-25T00:00:00Z')
    const leads = [
      lead({ id: 'recent', last_contacted_at: '2026-07-24T00:00:00Z' }), // 1 dia atrás
      lead({ id: 'old', last_contacted_at: '2026-05-01T00:00:00Z' }), // > 30 dias
      lead({ id: 'never', last_contacted_at: null }),
    ]
    const { included } = selectLeadRecipients(leads, { stale_days: 30 }, now)
    expect(included.map((r) => r.recipientId).sort()).toEqual(['never', 'old'])
  })
})

describe('selectCustomerRecipients', () => {
  it('default customer_status=active exclui inativos', () => {
    const customers = [customer({ id: 'a', status: 'active' }), customer({ id: 'b', status: 'inactive' })]
    const { included } = selectCustomerRecipients(customers, {})
    expect(included.map((r) => r.recipientId)).toEqual(['a'])
  })

  it("customer_status='all' inclui ativos e inativos", () => {
    const customers = [customer({ id: 'a', status: 'active' }), customer({ id: 'b', status: 'inactive' })]
    const { included } = selectCustomerRecipients(customers, { customer_status: 'all' })
    expect(included.map((r) => r.recipientId).sort()).toEqual(['a', 'b'])
  })

  it('pula cliente com opt-out ou sem e-mail', () => {
    const customers = [customer({ id: 'a', marketing_opt_out: true }), customer({ id: 'b', email: null })]
    const { included, skipped } = selectCustomerRecipients(customers, { customer_status: 'all' })
    expect(included).toHaveLength(0)
    expect(skipped.map((s) => s.reason)).toEqual(['skipped_opt_out', 'skipped_no_email'])
  })
})

describe('buildAudience', () => {
  it("audience_type='both' combina leads e clientes elegíveis", () => {
    const result = buildAudience({
      audienceType: 'both',
      filter: {},
      leads: [lead({ id: 'l1' })],
      customers: [customer({ id: 'c1' })],
    })
    expect(result.included.map((r) => r.recipientId).sort()).toEqual(['c1', 'l1'])
  })

  it("audience_type='leads' ignora customers, mesmo que existam", () => {
    const result = buildAudience({
      audienceType: 'leads',
      filter: {},
      leads: [lead({ id: 'l1' })],
      customers: [customer({ id: 'c1' })],
    })
    expect(result.included.map((r) => r.recipientId)).toEqual(['l1'])
  })
})
