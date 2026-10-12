import { describe, expect, it } from 'vitest'
import { decideVisitReconcile } from '../facilit-reconcile'

const TZ = 'America/Phoenix'
const NOW = new Date('2026-10-12T15:00:00Z')

describe('decideVisitReconcile', () => {
  it('appointment já cotado + nova visita hoje: cria appointment novo', () => {
    expect(
      decideVisitReconcile({
        previousVisitDate: '2026-09-25T18:00:00Z',
        newVisitDate: '2026-10-12T16:00:00Z',
        appointment: { starts_at: '2026-09-25T18:00:00Z', status: 'completed', service_order_status: 'quote' },
        timezone: TZ,
        now: NOW,
      }),
    ).toBe('new_appointment')
  })

  it('appointment pendente parado em data passada e Facil-IT aponta pra hoje: remarca', () => {
    expect(
      decideVisitReconcile({
        previousVisitDate: '2026-10-12T17:00:00Z',
        newVisitDate: '2026-10-12T17:00:00Z',
        appointment: { starts_at: '2026-10-07T17:00:00Z', status: 'scheduled', service_order_status: 'pending' },
        timezone: TZ,
        now: NOW,
      }),
    ).toBe('reschedule')
  })

  it('Facil-IT mudou a data de um pendente futuro: remarca', () => {
    expect(
      decideVisitReconcile({
        previousVisitDate: '2026-10-14T17:00:00Z',
        newVisitDate: '2026-10-15T17:00:00Z',
        appointment: { starts_at: '2026-10-14T17:00:00Z', status: 'scheduled', service_order_status: 'pending' },
        timezone: TZ,
        now: NOW,
      }),
    ).toBe('reschedule')
  })

  it('admin ajustou o horário e a Facil-IT não mudou nada: não mexe', () => {
    expect(
      decideVisitReconcile({
        previousVisitDate: '2026-10-14T17:00:00Z',
        newVisitDate: '2026-10-14T17:00:00Z',
        appointment: { starts_at: '2026-10-14T19:00:00Z', status: 'scheduled', service_order_status: 'pending' },
        timezone: TZ,
        now: NOW,
      }),
    ).toBe('none')
  })

  it('já alinhado (mesmo instante): nunca cria duplicata', () => {
    expect(
      decideVisitReconcile({
        previousVisitDate: '2026-10-12T16:00:00Z',
        newVisitDate: '2026-10-12T16:00:00Z',
        appointment: { starts_at: '2026-10-12T16:00:00Z', status: 'scheduled', service_order_status: 'pending' },
        timezone: TZ,
        now: NOW,
      }),
    ).toBe('none')
  })

  it('appointment cancelado ou finalizado com visita no passado: não mexe', () => {
    expect(
      decideVisitReconcile({
        previousVisitDate: '2026-10-01T17:00:00Z',
        newVisitDate: '2026-10-02T17:00:00Z',
        appointment: { starts_at: '2026-10-01T17:00:00Z', status: 'cancelled', service_order_status: 'pending' },
        timezone: TZ,
        now: NOW,
      }),
    ).toBe('none')
    expect(
      decideVisitReconcile({
        previousVisitDate: '2026-10-01T17:00:00Z',
        newVisitDate: '2026-10-02T17:00:00Z',
        appointment: { starts_at: '2026-10-01T17:00:00Z', status: 'completed', service_order_status: 'completed' },
        timezone: TZ,
        now: NOW,
      }),
    ).toBe('none')
  })
})
