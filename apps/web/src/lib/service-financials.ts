import { round2 } from '@/lib/service-pay'
import type { Invoice, ServiceRecord } from '@/lib/types'

// Cálculos financeiros da tela de Operação (migration 055) — extraídos
// pra lib pura e testável porque essa tela já causou 2 incidentes de
// confiança com o dono do produto (números que não batiam entre si, ou
// não batiam com o que ele via na prática). Toda soma exibida nos
// cards/resumos do painel deve vir de UMA destas funções, nunca ser
// recalculada solta no componente — assim os totais são sempre
// auditáveis por construção (a soma das partes É o total, não uma
// aproximação que pode divergir).

type RecordForSummary = Pick<ServiceRecord, 'amount_charged' | 'amount_due' | 'amount_paid_to_employee' | 'invoice_id'>

/**
 * Resumo financeiro de um conjunto de service_records (tipicamente o
 * mês selecionado na tela, ou o recorte de um funcionário específico).
 *
 * Invariantes garantidos por construção (cobertos em teste):
 *   totalOrdersAmount === invoicedAmount + notInvoicedAmount
 *   employeeTotalPayroll === employeePaid + employeeDue
 */
export type ServiceRecordsSummary = {
  /** soma de amount_charged de todos os lançamentos do recorte — "quanto foi executado" */
  totalOrdersAmount: number
  /** soma de amount_charged dos lançamentos já vinculados a alguma fatura (invoice_id != null) */
  invoicedAmount: number
  /** soma de amount_charged dos lançamentos ainda sem fatura — mesmo total mostrado em "Faturar serviços pendentes" */
  notInvoicedAmount: number
  /** soma de amount_due de todos os lançamentos — obrigação total da folha do recorte */
  employeeTotalPayroll: number
  /** soma de amount_paid_to_employee — já pago à equipe */
  employeePaid: number
  /** soma do saldo restante (amount_due - amount_paid_to_employee, nunca negativo) — ainda a pagar à equipe */
  employeeDue: number
}

export function summarizeServiceRecords(records: RecordForSummary[]): ServiceRecordsSummary {
  let totalOrdersAmount = 0
  let invoicedAmount = 0
  let notInvoicedAmount = 0
  let employeeTotalPayroll = 0
  let employeePaid = 0
  let employeeDue = 0

  for (const r of records) {
    const charged = r.amount_charged ?? 0
    totalOrdersAmount += charged
    if (r.invoice_id !== null) invoicedAmount += charged
    else notInvoicedAmount += charged

    const due = r.amount_due ?? 0
    const paid = r.amount_paid_to_employee ?? 0
    employeeTotalPayroll += due
    employeePaid += paid
    employeeDue += Math.max(due - paid, 0)
  }

  return {
    totalOrdersAmount: round2(totalOrdersAmount),
    invoicedAmount: round2(invoicedAmount),
    notInvoicedAmount: round2(notInvoicedAmount),
    employeeTotalPayroll: round2(employeeTotalPayroll),
    employeePaid: round2(employeePaid),
    employeeDue: round2(employeeDue),
  }
}

type RecordForEmployeeSummary = RecordForSummary & {
  employee_id: string | null
  employee: { id: string; name: string } | null
}

export type EmployeeServiceSummary = {
  employeeId: string
  employeeName: string
  totalCharged: number
  totalDue: number
  totalPaid: number
  totalRemaining: number
  recordCount: number
}

/** chave usada pra agrupar lançamentos sem employee_id — mesmo valor usado no filtro "por funcionário" da tela de Operação */
export const UNASSIGNED_EMPLOYEE_ID = '__none__'

/**
 * Mesma fonte de dados que summarizeServiceRecords, agrupada por
 * funcionário — usada tanto nos chips de "Equipe" quanto na visão
 * detalhada de um funcionário (filtrar records por employeeId e chamar
 * summarizeServiceRecords direto dá o mesmo resultado da linha aqui,
 * por construção).
 */
export function summarizeByEmployee(records: RecordForEmployeeSummary[]): EmployeeServiceSummary[] {
  const map = new Map<string, EmployeeServiceSummary>()

  for (const r of records) {
    const employeeId = r.employee_id ?? UNASSIGNED_EMPLOYEE_ID
    const employeeName = r.employee?.name ?? 'Sem profissional'
    const entry = map.get(employeeId) ?? {
      employeeId,
      employeeName,
      totalCharged: 0,
      totalDue: 0,
      totalPaid: 0,
      totalRemaining: 0,
      recordCount: 0,
    }
    const due = r.amount_due ?? 0
    const paid = r.amount_paid_to_employee ?? 0
    entry.totalCharged += r.amount_charged ?? 0
    entry.totalDue += due
    entry.totalPaid += paid
    entry.totalRemaining += Math.max(due - paid, 0)
    entry.recordCount += 1
    map.set(employeeId, entry)
  }

  return [...map.values()]
    .map((entry) => ({
      ...entry,
      totalCharged: round2(entry.totalCharged),
      totalDue: round2(entry.totalDue),
      totalPaid: round2(entry.totalPaid),
      totalRemaining: round2(entry.totalRemaining),
    }))
    .sort((a, b) => b.totalRemaining - a.totalRemaining || b.totalPaid - a.totalPaid)
}

type InvoiceForSummary = Pick<Invoice, 'amount' | 'status'>

export type InvoicesSummary = {
  /** soma de invoices ativas (exclui canceladas e as substituídas por consolidação) — valor real faturado ao cliente */
  activeInvoicedAmount: number
  /** subconjunto das ativas com status='paid' — dinheiro de fato recebido */
  receivedAmount: number
}

/**
 * 'consolidated' = fatura substituída por uma consolidada mais nova
 * (migration 045/047) — contá-la de novo somaria o mesmo valor duas
 * vezes. 'cancelled' = fatura anulada, nunca foi cobrança real.
 */
export function summarizeInvoices(invoices: InvoiceForSummary[]): InvoicesSummary {
  let activeInvoicedAmount = 0
  let receivedAmount = 0

  for (const invoice of invoices) {
    if (invoice.status === 'consolidated' || invoice.status === 'cancelled') continue
    activeInvoicedAmount += Number(invoice.amount)
    if (invoice.status === 'paid') receivedAmount += Number(invoice.amount)
  }

  return {
    activeInvoicedAmount: round2(activeInvoicedAmount),
    receivedAmount: round2(receivedAmount),
  }
}
