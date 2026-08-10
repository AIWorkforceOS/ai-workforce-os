import { describe, expect, it } from 'vitest'
import { deriveClientOrderStatus } from '@/lib/portal-360/data'
import { CLIENT_PORTAL_SOURCE } from '@/lib/portal-360/constants'

describe('deriveClientOrderStatus', () => {
  it('pedido da 360 sem profissional ainda é pending_assignment', () => {
    expect(
      deriveClientOrderStatus({ status: 'scheduled', employee_id: null, source: CLIENT_PORTAL_SOURCE, service_order_status: 'pending' }),
    ).toBe('pending_assignment')
  })

  it('agendamento conversacional do Receptionist (employee_id null, outro source) NÃO é confundido com pendente de atribuição', () => {
    expect(
      deriveClientOrderStatus({ status: 'scheduled', employee_id: null, source: 'receptionist_chat', service_order_status: 'pending' }),
    ).toBe('scheduled')
  })

  it('depois que o admin atribui profissional, vira scheduled', () => {
    expect(
      deriveClientOrderStatus({ status: 'scheduled', employee_id: 'emp-1', source: CLIENT_PORTAL_SOURCE, service_order_status: 'pending' }),
    ).toBe('scheduled')
  })

  it('ordem finalizada pelo técnico vira completed', () => {
    expect(
      deriveClientOrderStatus({ status: 'scheduled', employee_id: 'emp-1', source: CLIENT_PORTAL_SOURCE, service_order_status: 'completed' }),
    ).toBe('completed')
  })

  it('ordem de cotação vira quote', () => {
    expect(
      deriveClientOrderStatus({ status: 'scheduled', employee_id: 'emp-1', source: CLIENT_PORTAL_SOURCE, service_order_status: 'quote' }),
    ).toBe('quote')
  })

  it('agendamento cancelado é sempre cancelled, mesmo sem profissional', () => {
    expect(
      deriveClientOrderStatus({ status: 'cancelled', employee_id: null, source: CLIENT_PORTAL_SOURCE, service_order_status: 'pending' }),
    ).toBe('cancelled')
  })
})
