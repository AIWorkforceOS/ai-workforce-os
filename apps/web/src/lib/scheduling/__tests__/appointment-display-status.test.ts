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

  it('sem ordem finalizada, mantém o status real do agendamento', () => {
    expect(effectiveDisplayStatus({ status: 'scheduled', service_order_status: 'pending' })).toBe('scheduled')
    expect(effectiveDisplayStatus({ status: 'confirmed', service_order_status: 'quote' })).toBe('confirmed')
  })

  it('cancelado ou falta nunca é sobrescrito por uma ordem finalizada antes do cancelamento', () => {
    expect(effectiveDisplayStatus({ status: 'cancelled', service_order_status: 'completed' })).toBe('cancelled')
    expect(effectiveDisplayStatus({ status: 'no_show', service_order_status: 'completed' })).toBe('no_show')
  })

  it('admin já concluiu manualmente: mantém concluído independente do service_order_status', () => {
    expect(effectiveDisplayStatus({ status: 'completed', service_order_status: 'pending' })).toBe('completed')
  })
})
