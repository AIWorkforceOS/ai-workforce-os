import { describe, expect, it } from 'vitest'
import { recommendFirstEmployee } from '@/lib/first-employee-recommendation'

describe('recommendFirstEmployee', () => {
  it('indica Recepção para atendimento e agenda', () => {
    expect(recommendFirstEmployee('customer_service').agentType).toBe('receptionist')
  })

  it('indica Sales para vendas', () => {
    expect(recommendFirstEmployee('sales').agentType).toBe('sdr')
  })

  it('indica Recrutador para contratação', () => {
    expect(recommendFirstEmployee('hiring').agentType).toBe('recruiter')
  })
})
