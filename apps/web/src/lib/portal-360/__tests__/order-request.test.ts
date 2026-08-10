import { describe, expect, it } from 'vitest'
import { buildClientOrderInsertRow, buildPlaceholderTimeRange, validateRequestedDate } from '@/lib/portal-360/order-request'
import { CLIENT_PORTAL_SOURCE } from '@/lib/portal-360/constants'
import type { ServiceOrderExtraction } from '@/lib/service-orders/extraction'

describe('validateRequestedDate', () => {
  it('aceita uma data futura válida', () => {
    const result = validateRequestedDate('2026-09-01', '2026-08-10')
    expect(result).toEqual({ ok: true, date: '2026-09-01' })
  })

  it('aceita o dia de hoje', () => {
    const result = validateRequestedDate('2026-08-10', '2026-08-10')
    expect(result.ok).toBe(true)
  })

  it('rejeita data no passado', () => {
    const result = validateRequestedDate('2026-08-01', '2026-08-10')
    expect(result.ok).toBe(false)
  })

  it('rejeita formato inválido', () => {
    expect(validateRequestedDate('08/10/2026', '2026-08-10').ok).toBe(false)
    expect(validateRequestedDate('', '2026-08-10').ok).toBe(false)
    expect(validateRequestedDate(undefined, '2026-08-10').ok).toBe(false)
    expect(validateRequestedDate(123, '2026-08-10').ok).toBe(false)
  })
})

describe('buildPlaceholderTimeRange', () => {
  it('gera um intervalo de 1h ao meio-dia local, nunca um horário real', () => {
    const { startsAt, endsAt } = buildPlaceholderTimeRange('2026-08-15', 'America/Sao_Paulo')
    const start = new Date(startsAt)
    const end = new Date(endsAt)
    expect(end.getTime() - start.getTime()).toBe(60 * 60 * 1000)
    // meio-dia em São Paulo (UTC-3) cai às 15:00 UTC
    expect(start.toISOString()).toBe('2026-08-15T15:00:00.000Z')
  })
})

describe('buildClientOrderInsertRow', () => {
  const customer = { id: 'customer-1', unitId: 'unit-1', orgId: 'org-1' }
  const extraction: ServiceOrderExtraction = {
    summaryPt: 'Resumo',
    scopeEn: 'Scope',
    address: '123 Main St',
    orderNumber: '99001',
    clientPo: 'CPO-1',
    priority: 'Low',
    orderType: 'Interior',
    ivrPin: '1234',
    locationName: 'Store #1',
    locationPhone: '555-0000',
    issuerName: 'Jane Doe',
    issuerEmail: 'jane@360.com',
  }

  it('nunca atribui profissional — employee_id sempre null e source identifica o pedido da 360', () => {
    const row = buildClientOrderInsertRow({
      customer,
      requestedDate: '2026-08-20',
      timezone: 'America/Sao_Paulo',
      fileUrl: 'https://files/ordem.pdf',
      fileName: 'ordem.pdf',
      extraction,
    })
    expect(row.employee_id).toBeNull()
    expect(row.source).toBe(CLIENT_PORTAL_SOURCE)
    expect(row.service_order_requested_date).toBe('2026-08-20')
    expect(row.service_order_number).toBe('99001')
    expect(row.customer_id).toBe('customer-1')
    expect(row.unit_id).toBe('unit-1')
    expect(row.org_id).toBe('org-1')
    expect(new Date(row.ends_at).getTime()).toBeGreaterThan(new Date(row.starts_at).getTime())
  })

  it('extração null (falhou/sem API key) nunca bloqueia — campos ficam null', () => {
    const row = buildClientOrderInsertRow({
      customer,
      requestedDate: '2026-08-20',
      timezone: 'America/Sao_Paulo',
      fileUrl: 'https://files/ordem.pdf',
      fileName: 'ordem.pdf',
      extraction: null,
    })
    expect(row.service_order_number).toBeNull()
    expect(row.address).toBeNull()
    expect(row.employee_id).toBeNull()
    expect(row.service_order_file_url).toBe('https://files/ordem.pdf')
  })
})
