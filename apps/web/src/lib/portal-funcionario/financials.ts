import { round2 } from '@/lib/service-pay'
import type { PortalServiceRecord } from './data'

// Resumo financeiro do Portal do Funcionário — mesmo padrão de
// lib/service-financials.ts (função pura testada, soma das partes =
// total exibido), mas do ponto de vista do funcionário: ele não vê
// amount_charged (o que o cliente paga), só o que é devido/pago/falta
// a ELE (amount_due/amount_paid_to_employee).

type RecordForEmployeeSummary = Pick<PortalServiceRecord, 'amount_due' | 'amount_paid_to_employee'>

/**
 * Invariante garantido por construção (coberto em teste):
 *   totalDue === totalPaid + totalRemaining
 * (assumindo que não há pagamento maior que o devido em nenhum lançamento —
 * mesma premissa de summarizeServiceRecords em lib/service-financials.ts).
 */
export type EmployeeFinancialSummary = {
  /** soma de amount_due do recorte — total lançado a receber pelo funcionário */
  totalDue: number
  /** soma de amount_paid_to_employee — já pago ao funcionário */
  totalPaid: number
  /** soma do saldo restante (amount_due - amount_paid_to_employee, nunca negativo) — falta receber */
  totalRemaining: number
  recordCount: number
}

export function summarizeEmployeeServiceRecords(records: RecordForEmployeeSummary[]): EmployeeFinancialSummary {
  let totalDue = 0
  let totalPaid = 0
  let totalRemaining = 0

  for (const r of records) {
    const due = r.amount_due ?? 0
    const paid = r.amount_paid_to_employee ?? 0
    totalDue += due
    totalPaid += paid
    totalRemaining += Math.max(due - paid, 0)
  }

  return {
    totalDue: round2(totalDue),
    totalPaid: round2(totalPaid),
    totalRemaining: round2(totalRemaining),
    recordCount: records.length,
  }
}
