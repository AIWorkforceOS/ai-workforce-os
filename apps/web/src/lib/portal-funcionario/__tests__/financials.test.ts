import { describe, expect, it } from 'vitest'
import { monthRange } from '@/lib/service-operations-month'
import { summarizeEmployeeServiceRecords } from '../financials'

// Mesmo espírito dos testes de lib/service-financials.ts: os cards de
// resumo do Portal do Funcionário precisam ser sempre auditáveis (soma
// das partes = total exibido), já que essa área do produto causou 2
// incidentes de confiança antes.

describe('summarizeEmployeeServiceRecords', () => {
  it('totalDue é sempre igual a totalPaid + totalRemaining (nunca fica negativo)', () => {
    const records = [
      { amount_due: 80, amount_paid_to_employee: 80 }, // pago total
      { amount_due: 60, amount_paid_to_employee: 30 }, // parcial
      { amount_due: 50, amount_paid_to_employee: 0 }, // pendente
      { amount_due: null, amount_paid_to_employee: 0 }, // sem valor a pagar
    ]

    const summary = summarizeEmployeeServiceRecords(records)

    expect(summary.totalDue).toBe(190) // 80+60+50+0
    expect(summary.totalPaid).toBe(110) // 80+30
    expect(summary.totalRemaining).toBe(80) // 0+30+50+0
    expect(summary.totalPaid + summary.totalRemaining).toBe(summary.totalDue)
    expect(summary.recordCount).toBe(4)
  })

  it('lista vazia devolve tudo zerado, sem NaN', () => {
    const summary = summarizeEmployeeServiceRecords([])
    expect(summary).toEqual({ totalDue: 0, totalPaid: 0, totalRemaining: 0, recordCount: 0 })
  })

  it('não arredonda errado com valores fracionários (soma em ponto flutuante)', () => {
    const records = Array.from({ length: 10 }, () => ({ amount_due: 0.1, amount_paid_to_employee: 0.1 }))
    const summary = summarizeEmployeeServiceRecords(records)
    expect(summary.totalDue).toBe(1)
    expect(summary.totalPaid).toBe(1)
    expect(summary.totalRemaining).toBe(0)
  })

  it('amount_paid_to_employee null conta como zero pago (tudo falta receber)', () => {
    const records = [{ amount_due: 100, amount_paid_to_employee: null as unknown as number }]
    const summary = summarizeEmployeeServiceRecords(records)
    expect(summary.totalPaid).toBe(0)
    expect(summary.totalRemaining).toBe(100)
  })

  // Regressão direta do bug já visto 2x nesta área do produto (Operação
  // da unidade, migration 052): o seletor de mês do portal filtra
  // service_records por monthRange(selectedMonth) antes de somar — julho
  // nunca pode vazar pro card de agosto, nem o contrário.
  it('o resumo do mês selecionado não mistura lançamentos de outro mês (fluxo real do seletor de mês)', () => {
    const records = [
      { service_date: '2026-07-31', amount_due: 500, amount_paid_to_employee: 500 },
      { service_date: '2026-08-01', amount_due: 80, amount_paid_to_employee: 30 },
      { service_date: '2026-08-15', amount_due: 40, amount_paid_to_employee: 0 },
      { service_date: '2026-08-31', amount_due: 20, amount_paid_to_employee: 20 },
      { service_date: '2026-09-01', amount_due: 999, amount_paid_to_employee: 0 },
    ]

    const { start, nextStart } = monthRange('2026-08')
    const augustOnly = records.filter((r) => r.service_date >= start && r.service_date < nextStart)
    const summary = summarizeEmployeeServiceRecords(augustOnly)

    expect(augustOnly).toHaveLength(3)
    expect(summary.totalDue).toBe(140) // 80+40+20, sem o de julho (500) nem o de setembro (999)
    expect(summary.totalPaid).toBe(50) // 30+0+20
    expect(summary.totalRemaining).toBe(90) // 50+40+0
  })
})
