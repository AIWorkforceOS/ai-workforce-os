import type { Employee, EmployeePayType } from '@/lib/types'

// Sugestão de valor a pagar ao profissional por um serviço executado
// (migration 030). É só um DEFAULT pré-preenchido a partir de
// employees.default_pay/default_pay_type — o valor final vive em
// service_records.amount_due e é sempre editável pela empresa.

export const PAY_TYPE_LABEL: Record<EmployeePayType, string> = {
  per_service: 'Por serviço',
  per_hour: 'Por hora',
  per_day: 'Diária',
  percent: '% do serviço',
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function computeSuggestedPay(params: {
  employee: Pick<Employee, 'default_pay' | 'default_pay_type'> | null | undefined
  /** valor cobrado do cliente (base do tipo percent) */
  amountCharged: number | null
  /** duração do atendimento (base do tipo per_hour) */
  durationMinutes: number | null
}): number | null {
  const { employee, amountCharged, durationMinutes } = params
  if (!employee || employee.default_pay === null || employee.default_pay === undefined) return null

  switch (employee.default_pay_type) {
    case 'per_service':
      return round2(employee.default_pay)
    case 'per_hour':
      return durationMinutes ? round2((employee.default_pay * durationMinutes) / 60) : null
    case 'percent':
      return amountCharged ? round2((amountCharged * employee.default_pay) / 100) : null
    // Diária não é atribuível a um serviço individual — sem sugestão automática.
    case 'per_day':
      return null
  }
}
