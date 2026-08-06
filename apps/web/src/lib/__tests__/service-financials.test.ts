import { describe, expect, it } from 'vitest'
import {
  summarizeByEmployee,
  summarizeInvoices,
  summarizeServiceRecords,
} from '@/lib/service-financials'

// Regressão direta do pedido do dono do produto: "8.375 em ordens mais a
// invoice está cobrando 8.145 pq???" — os cards da tela de Operação
// precisam ser sempre auditáveis (soma das partes = total exibido) e
// nunca mais parecer que um valor "sumiu" sem explicação. Estes testes
// travam os invariantes matemáticos que sustentam essa promessa.

describe('summarizeServiceRecords', () => {
  it('totalOrdersAmount é sempre igual a invoicedAmount + notInvoicedAmount', () => {
    const records = [
      { amount_charged: 200, amount_due: 80, amount_paid_to_employee: 80, invoice_id: 'inv-1' },
      { amount_charged: 150, amount_due: 60, amount_paid_to_employee: 30, invoice_id: null },
      { amount_charged: 100, amount_due: null, amount_paid_to_employee: 0, invoice_id: null },
      { amount_charged: null, amount_due: 40, amount_paid_to_employee: 40, invoice_id: 'inv-2' },
    ]

    const summary = summarizeServiceRecords(records)

    expect(summary.totalOrdersAmount).toBe(450)
    expect(summary.invoicedAmount).toBe(200) // só o registro com invoice_id != null e amount_charged
    expect(summary.notInvoicedAmount).toBe(250)
    expect(summary.invoicedAmount + summary.notInvoicedAmount).toBe(summary.totalOrdersAmount)
  })

  it('employeeTotalPayroll é sempre igual a employeePaid + employeeDue (nunca fica negativo)', () => {
    const records = [
      { amount_charged: 200, amount_due: 80, amount_paid_to_employee: 80, invoice_id: null }, // pago total
      { amount_charged: 150, amount_due: 60, amount_paid_to_employee: 30, invoice_id: null }, // parcial
      { amount_charged: 100, amount_due: 50, amount_paid_to_employee: 0, invoice_id: null }, // pendente
      { amount_charged: 80, amount_due: null, amount_paid_to_employee: 0, invoice_id: null }, // sem valor a pagar
    ]

    const summary = summarizeServiceRecords(records)

    expect(summary.employeeTotalPayroll).toBe(190) // 80+60+50+0
    expect(summary.employeePaid).toBe(110) // 80+30
    expect(summary.employeeDue).toBe(80) // 0+30+50+0
    expect(summary.employeePaid + summary.employeeDue).toBe(summary.employeeTotalPayroll)
  })

  it('lista vazia devolve tudo zerado, sem NaN', () => {
    const summary = summarizeServiceRecords([])
    expect(summary).toEqual({
      totalOrdersAmount: 0,
      invoicedAmount: 0,
      notInvoicedAmount: 0,
      employeeTotalPayroll: 0,
      employeePaid: 0,
      employeeDue: 0,
    })
  })

  it('não arredonda errado com valores fracionários (soma em ponto flutuante)', () => {
    const records = Array.from({ length: 10 }, () => ({
      amount_charged: 0.1,
      amount_due: 0.1,
      amount_paid_to_employee: 0.1,
      invoice_id: null,
    }))
    const summary = summarizeServiceRecords(records)
    expect(summary.totalOrdersAmount).toBe(1)
    expect(summary.employeePaid).toBe(1)
  })
})

describe('summarizeByEmployee', () => {
  const records = [
    {
      amount_charged: 200,
      amount_due: 80,
      amount_paid_to_employee: 30,
      invoice_id: 'inv-1',
      employee_id: 'emp-1',
      employee: { id: 'emp-1', name: 'Murilo' },
    },
    {
      amount_charged: 150,
      amount_due: 60,
      amount_paid_to_employee: 60,
      invoice_id: null,
      employee_id: 'emp-1',
      employee: { id: 'emp-1', name: 'Murilo' },
    },
    {
      amount_charged: 100,
      amount_due: 40,
      amount_paid_to_employee: 0,
      invoice_id: null,
      employee_id: 'emp-2',
      employee: { id: 'emp-2', name: 'Ana' },
    },
    {
      amount_charged: 90,
      amount_due: 30,
      amount_paid_to_employee: 0,
      invoice_id: null,
      employee_id: null,
      employee: null,
    },
  ]

  it('agrupa por funcionário e soma cada linha (inclui "sem profissional")', () => {
    const byEmployee = summarizeByEmployee(records)
    const murilo = byEmployee.find((e) => e.employeeName === 'Murilo')!
    const ana = byEmployee.find((e) => e.employeeName === 'Ana')!
    const unassigned = byEmployee.find((e) => e.employeeName === 'Sem profissional')!

    expect(murilo.totalDue).toBe(140)
    expect(murilo.totalPaid).toBe(90)
    expect(murilo.totalRemaining).toBe(50)
    expect(murilo.recordCount).toBe(2)

    expect(ana.totalDue).toBe(40)
    expect(ana.totalRemaining).toBe(40)

    expect(unassigned.totalDue).toBe(30)
  })

  it('a soma de todos os funcionários bate exatamente com summarizeServiceRecords do mesmo conjunto', () => {
    const byEmployee = summarizeByEmployee(records)
    const overall = summarizeServiceRecords(records)

    const sumDue = byEmployee.reduce((s, e) => s + e.totalDue, 0)
    const sumPaid = byEmployee.reduce((s, e) => s + e.totalPaid, 0)
    const sumRemaining = byEmployee.reduce((s, e) => s + e.totalRemaining, 0)
    const sumCharged = byEmployee.reduce((s, e) => s + e.totalCharged, 0)

    expect(sumDue).toBeCloseTo(overall.employeeTotalPayroll, 5)
    expect(sumPaid).toBeCloseTo(overall.employeePaid, 5)
    expect(sumRemaining).toBeCloseTo(overall.employeeDue, 5)
    expect(sumCharged).toBeCloseTo(overall.totalOrdersAmount, 5)
  })

  it('filtrar records por employeeId e resumir dá o mesmo resultado da linha do funcionário (visão por funcionário não pode divergir da lista)', () => {
    const muriloRecords = records.filter((r) => r.employee_id === 'emp-1')
    const muriloSummary = summarizeServiceRecords(muriloRecords)
    const byEmployee = summarizeByEmployee(records)
    const murilo = byEmployee.find((e) => e.employeeName === 'Murilo')!

    expect(murilo.totalDue).toBe(muriloSummary.employeeTotalPayroll)
    expect(murilo.totalPaid).toBe(muriloSummary.employeePaid)
    expect(murilo.totalRemaining).toBe(muriloSummary.employeeDue)
    expect(murilo.totalCharged).toBe(muriloSummary.totalOrdersAmount)
  })
})

describe('summarizeInvoices', () => {
  it('exclui faturas consolidadas (substituídas) e canceladas do total ativo — evita contar o mesmo valor duas vezes', () => {
    const invoices = [
      { amount: 500, status: 'draft' as const },
      { amount: 300, status: 'paid' as const },
      { amount: 200, status: 'consolidated' as const }, // já virou outra fatura — não conta de novo
      { amount: 100, status: 'cancelled' as const }, // nunca foi cobrança real
      { amount: 700, status: 'consolidated' as const, },
    ]

    const summary = summarizeInvoices(invoices)

    expect(summary.activeInvoicedAmount).toBe(800) // 500 + 300
    expect(summary.receivedAmount).toBe(300)
  })

  it('lista vazia devolve zero', () => {
    expect(summarizeInvoices([])).toEqual({ activeInvoicedAmount: 0, receivedAmount: 0 })
  })
})
