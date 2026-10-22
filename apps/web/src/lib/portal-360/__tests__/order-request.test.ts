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

  const baseFields = { requestedDate: '2026-08-20', description: null, priority: null, locationName: null, address: null, approvedAmount: null, approvedHours: null }

  it('nunca atribui profissional — employee_id sempre null e source identifica o pedido da 360', () => {
    const row = buildClientOrderInsertRow({
      customer,
      fields: baseFields,
      timezone: 'America/Sao_Paulo',
      file: { url: 'https://files/ordem.pdf', name: 'ordem.pdf' },
      photoUrls: [],
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
      fields: baseFields,
      timezone: 'America/Sao_Paulo',
      file: { url: 'https://files/ordem.pdf', name: 'ordem.pdf' },
      photoUrls: [],
      extraction: null,
    })
    expect(row.service_order_number).toBeNull()
    expect(row.address).toBeNull()
    expect(row.employee_id).toBeNull()
    expect(row.service_order_file_url).toBe('https://files/ordem.pdf')
  })
})

import { parseNewOrderFields } from '../order-request'

describe('parseNewOrderFields', () => {
  const form = (o: Record<string, unknown>) => (k: string) => o[k]
  const base = { requestedDate: '2026-11-03', description: 'Replace the broken exit sign' }
  it('aceita só texto (sem arquivo) e normaliza os campos', () => {
    const r = parseNewOrderFields(form({ ...base, priority: 'High', locationName: ' Store 12 ', approvedAmount: '$1,250.50', approvedHours: '6' }), '2026-11-01', false)
    expect(r).toEqual({ ok: true, value: { requestedDate: '2026-11-03', description: 'Replace the broken exit sign', priority: 'High', locationName: 'Store 12', address: null, approvedAmount: 1250.5, approvedHours: 6 } })
  })
  it('exige arquivo OU descrição', () => {
    expect(parseNewOrderFields(form({ requestedDate: '2026-11-03' }), '2026-11-01', false)).toMatchObject({ ok: false })
    expect(parseNewOrderFields(form({ requestedDate: '2026-11-03' }), '2026-11-01', true)).toMatchObject({ ok: true })
  })
  it('valida data, prioridade e números', () => {
    expect(parseNewOrderFields(form({ ...base, requestedDate: '2026-10-01' }), '2026-11-01', false)).toMatchObject({ ok: false })
    expect(parseNewOrderFields(form({ ...base, priority: 'Whenever' }), '2026-11-01', false)).toMatchObject({ ok: false, error: expect.stringMatching(/priority/i) })
    expect(parseNewOrderFields(form({ ...base, approvedAmount: '-5' }), '2026-11-01', false)).toMatchObject({ ok: false })
    expect(parseNewOrderFields(form({ ...base, approvedHours: 'abc' }), '2026-11-01', false)).toMatchObject({ ok: false })
    expect(parseNewOrderFields(form({ ...base, approvedAmount: '' }), '2026-11-01', false)).toMatchObject({ ok: true })
  })
  it('o texto do cliente vira o escopo quando não há documento; o que ele informou vai para client_request', () => {
    const fields = { requestedDate: '2026-11-03', description: 'Fix the door', priority: 'Low', locationName: 'Store 3', address: '1 Main St', approvedAmount: 300, approvedHours: 4 }
    const row = buildClientOrderInsertRow({ customer: { id: 'c', unitId: 'u', orgId: 'o' }, fields, timezone: 'America/New_York', file: null, photoUrls: ['https://p/1.jpg'], extraction: null })
    expect(row).toMatchObject({ service_order_scope_en: 'Fix the door', service_order_priority: 'Low', service_order_location_name: 'Store 3', address: '1 Main St', service_order_file_url: null, employee_id: null })
    expect(row.custom_fields).toEqual({ client_request: { description: 'Fix the door', approvedAmount: 300, approvedHours: 4, photos: ['https://p/1.jpg'] } })
  })
})
