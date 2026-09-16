import { describe, expect, it } from 'vitest'
import { effectiveDisplayStatus } from '../appointment-display-status'

// Bug real (2026-09-15): técnico finalizava e assinava a ordem no
// Portal do Funcionário (service_order_status = 'completed'), mas o
// selo principal da Agenda do admin continuava mostrando "Agendado" —
// status (agenda) e service_order_status (execução) são campos
// distintos que nunca se sincronizavam sozinhos.

describe('effectiveDisplayStatus', () => {
  it('técnico finalizou a ordem: selo mostra concluído mesmo com status ainda scheduled/confirmed', () => {
    expect(effectiveDisplayStatus({ status: 'scheduled', service_order_status: 'completed' })).toBe('completed')
    expect(effectiveDisplayStatus({ status: 'confirmed', service_order_status: 'completed' })).toBe('completed')
  })

  // Bug real (2026-09-16, teste do Vinicius): cotação finalizada aparecia
  // como "Concluído" (ou continuava "Agendado") — precisa de selo próprio
  // "Cotação", distinto dos dois, já que ainda precisa de ação (mandar
  // pro cliente), não é o mesmo que um serviço já fechado.
  it('ordem em cotação: selo mostra "quote", nunca "completed" nem o status normal do agendamento', () => {
    expect(effectiveDisplayStatus({ status: 'scheduled', service_order_status: 'quote' })).toBe('quote')
    expect(effectiveDisplayStatus({ status: 'confirmed', service_order_status: 'quote' })).toBe('quote')
  })

  it('sem ordem finalizada nem cotação, mantém o status real do agendamento', () => {
    expect(effectiveDisplayStatus({ status: 'scheduled', service_order_status: 'pending' })).toBe('scheduled')
    expect(effectiveDisplayStatus({ status: 'confirmed', service_order_status: 'pending' })).toBe('confirmed')
  })

  it('cancelado ou falta nunca é sobrescrito por uma ordem finalizada/cotação antes do cancelamento', () => {
    expect(effectiveDisplayStatus({ status: 'cancelled', service_order_status: 'completed' })).toBe('cancelled')
    expect(effectiveDisplayStatus({ status: 'no_show', service_order_status: 'completed' })).toBe('no_show')
    expect(effectiveDisplayStatus({ status: 'cancelled', service_order_status: 'quote' })).toBe('cancelled')
  })

  it('admin já concluiu manualmente: mantém concluído independente do service_order_status', () => {
    expect(effectiveDisplayStatus({ status: 'completed', service_order_status: 'pending' })).toBe('completed')
  })
})
