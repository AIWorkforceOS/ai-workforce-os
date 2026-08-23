import { describe, expect, it } from 'vitest'
import { holidayOnDate, holidaysInRange } from '../holidays'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

describe('holidaysInRange', () => {
  it('encontra Natal e Véspera de Natal numa semana de dezembro', () => {
    const results = holidaysInRange(utc(2026, 12, 20), utc(2026, 12, 26))
    const names = results.map((h) => h.name)
    expect(names).toContain('Natal')
    expect(names).toContain('Véspera de Natal')
  })

  it('Natal é sempre 25 de dezembro, em qualquer ano', () => {
    for (const year of [2026, 2027, 2030]) {
      const [natal] = holidaysInRange(utc(year, 12, 25), utc(year, 12, 25))
      expect(natal?.date.getUTCMonth()).toBe(11)
      expect(natal?.date.getUTCDate()).toBe(25)
    }
  })

  it('atravessa a virada do ano corretamente (Véspera de Ano Novo + Ano Novo no mesmo intervalo)', () => {
    const results = holidaysInRange(utc(2026, 12, 28), utc(2027, 1, 3))
    const names = results.map((h) => h.name)
    expect(names).toContain('Véspera de Ano Novo')
    expect(names).toContain('Ano Novo')
  })

  it('Thanksgiving sempre cai numa quinta-feira', () => {
    for (const year of [2026, 2027, 2028]) {
      const results = holidaysInRange(utc(year, 11, 1), utc(year, 11, 30))
      const thanksgiving = results.find((h) => h.name.includes('Thanksgiving'))
      expect(thanksgiving?.date.getUTCDay()).toBe(4) // quinta-feira
    }
  })

  it('Black Friday é sempre o dia seguinte ao Thanksgiving e cai numa sexta-feira', () => {
    const results = holidaysInRange(utc(2026, 11, 1), utc(2026, 12, 5))
    const thanksgiving = results.find((h) => h.name.includes('Thanksgiving'))!
    const blackFriday = results.find((h) => h.name === 'Black Friday')!
    expect(blackFriday.date.getUTCDay()).toBe(5) // sexta-feira
    expect(blackFriday.date.getTime() - thanksgiving.date.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('Dia das Mães cai num domingo de maio', () => {
    const results = holidaysInRange(utc(2026, 5, 1), utc(2026, 5, 31))
    const mothersDay = results.find((h) => h.name.includes('Mães'))
    expect(mothersDay?.date.getUTCDay()).toBe(0) // domingo
    expect(mothersDay?.date.getUTCMonth()).toBe(4) // maio (0-indexed)
  })

  it('intervalo sem nenhuma data comemorativa devolve lista vazia', () => {
    expect(holidaysInRange(utc(2026, 3, 2), utc(2026, 3, 6))).toEqual([])
  })

  it('resultado vem ordenado por data', () => {
    const results = holidaysInRange(utc(2026, 1, 1), utc(2026, 12, 31))
    const times = results.map((h) => h.date.getTime())
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})

describe('holidayOnDate', () => {
  it('devolve o feriado quando a data cai exatamente nele', () => {
    expect(holidayOnDate(utc(2026, 12, 25))?.name).toBe('Natal')
  })

  it('devolve null pra um dia qualquer sem data comemorativa', () => {
    expect(holidayOnDate(utc(2026, 3, 3))).toBeNull()
  })
})
