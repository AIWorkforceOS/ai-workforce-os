import { describe, expect, it } from 'vitest'
import { isWinbackEligible, WINBACK_AFTER_DAYS } from '../care'

describe('isWinbackEligible', () => {
  const now = new Date('2026-08-26T12:00:00.000Z')

  function daysAgoIso(days: number): string {
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
  }

  it('cliente sem nenhum serviço concluído: nunca elegível (nunca foi cliente ativo de verdade)', () => {
    expect(isWinbackEligible(null, now)).toBe(false)
  })

  it('último serviço concluído há poucos dias: não elegível', () => {
    expect(isWinbackEligible(daysAgoIso(5), now)).toBe(false)
  })

  it(`último serviço concluído há exatamente ${WINBACK_AFTER_DAYS} dias: elegível`, () => {
    expect(isWinbackEligible(daysAgoIso(WINBACK_AFTER_DAYS), now)).toBe(true)
  })

  it('último serviço concluído há muito tempo: elegível', () => {
    expect(isWinbackEligible(daysAgoIso(200), now)).toBe(true)
  })
})
