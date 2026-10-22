import { describe, expect, it } from 'vitest'
import { buildClientOverview } from '../overview'

const o = (clientName: string, extra: Record<string, unknown> = {}) => ({ clientName, serviceOrderStatus: 'pending', invoiceId: null, invoiceStatus: null, paid: false, ...extra })

describe('buildClientOverview', () => {
  it('conta por etapa, une grafias iguais e ordena por cotações aguardando', () => {
    const r = buildClientOverview(['360 Service Provider', 'Zeta'], [
      o('360 Service Provider'),
      o('360  service provider', { serviceOrderStatus: 'quote' }),
      o('Beta', { serviceOrderStatus: 'quote' }),
      o('Beta', { serviceOrderStatus: 'quote' }),
      o('Beta', { serviceOrderStatus: 'quote', quoteDecision: 'rejected' }),
    ])
    expect(r.clients.map((c) => c.name)).toEqual(['Beta', '360 Service Provider', 'Zeta'])
    const beta = r.clients[0]!
    expect(beta.total).toBe(3)
    expect(beta.awaitingApproval).toBe(2)
    expect(beta.registered).toBe(false)
    const s360 = r.clients[1]!
    expect(s360.total).toBe(2)
    expect(s360.stages.agendada).toBe(1)
    expect(s360.stages.cotacao).toBe(1)
    expect(r.clients[2]!.total).toBe(0)
  })
  it('separa ordens sem cliente', () => {
    expect(buildClientOverview([], [o('Sem cliente vinculado'), o('')]).unlinked).toBe(2)
  })
})
