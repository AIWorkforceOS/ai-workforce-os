import { describe, expect, it } from 'vitest'
import { groupByStage, stageOf } from '../pipeline'

const base = { serviceOrderStatus: 'pending', invoiceId: null, invoiceStatus: null, paid: false }

describe('stageOf', () => {
  it('classifica cada etapa', () => {
    expect(stageOf(base)).toBe('agendada')
    expect(stageOf({ ...base, serviceOrderStatus: 'quote' })).toBe('cotacao')
    expect(stageOf({ ...base, serviceOrderStatus: 'completed' })).toBe('concluida')
    expect(stageOf({ ...base, serviceOrderStatus: 'completed', invoiceId: 'i1', invoiceStatus: 'sent' })).toBe('faturada')
    expect(stageOf({ ...base, serviceOrderStatus: 'completed', invoiceId: 'i1', paid: true })).toBe('recebida')
    expect(stageOf({ ...base, invoiceStatus: 'paid' })).toBe('recebida')
  })
  it('agrupa por etapa', () => {
    const g = groupByStage([base, { ...base, serviceOrderStatus: 'quote' }, base])
    expect(g.agendada).toHaveLength(2)
    expect(g.cotacao).toHaveLength(1)
    expect(g.recebida).toHaveLength(0)
  })
})
