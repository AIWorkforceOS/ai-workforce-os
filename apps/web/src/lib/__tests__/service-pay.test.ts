import { describe, expect, it } from 'vitest'
import { computeSuggestedPay } from '@/lib/service-pay'
import type { EmployeePayType } from '@/lib/types'

function employee(default_pay: number | null, default_pay_type: EmployeePayType) {
  return { default_pay, default_pay_type }
}

describe('computeSuggestedPay', () => {
  it('sem funcionário ou sem valor padrão → sem sugestão', () => {
    expect(computeSuggestedPay({ employee: null, amountCharged: 200, durationMinutes: 60 })).toBeNull()
    expect(computeSuggestedPay({ employee: employee(null, 'per_service'), amountCharged: 200, durationMinutes: 60 })).toBeNull()
  })

  it('per_service devolve o valor fixo', () => {
    expect(computeSuggestedPay({ employee: employee(120, 'per_service'), amountCharged: null, durationMinutes: null })).toBe(120)
  })

  it('per_hour multiplica pela duração em horas', () => {
    expect(computeSuggestedPay({ employee: employee(50, 'per_hour'), amountCharged: null, durationMinutes: 90 })).toBe(75)
    expect(computeSuggestedPay({ employee: employee(50, 'per_hour'), amountCharged: null, durationMinutes: null })).toBeNull()
  })

  it('percent calcula sobre o valor cobrado', () => {
    expect(computeSuggestedPay({ employee: employee(40, 'percent'), amountCharged: 250, durationMinutes: null })).toBe(100)
    expect(computeSuggestedPay({ employee: employee(40, 'percent'), amountCharged: null, durationMinutes: 60 })).toBeNull()
  })

  it('per_day nunca sugere por serviço individual', () => {
    expect(computeSuggestedPay({ employee: employee(200, 'per_day'), amountCharged: 300, durationMinutes: 480 })).toBeNull()
  })

  it('arredonda para 2 casas', () => {
    // 33.33% de 100 = 33.33
    expect(computeSuggestedPay({ employee: employee(33.33, 'percent'), amountCharged: 100, durationMinutes: null })).toBe(33.33)
    // 47/hora × 50min = 39.166... → 39.17
    expect(computeSuggestedPay({ employee: employee(47, 'per_hour'), amountCharged: null, durationMinutes: 50 })).toBe(39.17)
  })
})
