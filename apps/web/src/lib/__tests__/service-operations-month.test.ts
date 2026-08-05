import { describe, expect, it } from 'vitest'
import {
  defaultDateForMonth,
  monthRange,
  mostRecentMonth,
  resolveMonthSelection,
  resolveSelectedMonth,
  shiftMonth,
} from '@/lib/service-operations-month'

describe('resolveSelectedMonth', () => {
  it('mês ausente ou inválido cai no mês atual da unidade', () => {
    expect(resolveSelectedMonth(undefined, 'America/Sao_Paulo')).toMatch(/^\d{4}-\d{2}$/)
    expect(resolveSelectedMonth('lixo', 'America/Sao_Paulo')).toMatch(/^\d{4}-\d{2}$/)
    expect(resolveSelectedMonth('2026-13', 'America/Sao_Paulo')).toMatch(/^\d{4}-\d{2}$/)
    expect(resolveSelectedMonth('2026-00', 'America/Sao_Paulo')).toMatch(/^\d{4}-\d{2}$/)
  })

  it('mês válido é preservado', () => {
    expect(resolveSelectedMonth('2026-07', 'America/Sao_Paulo')).toBe('2026-07')
    expect(resolveSelectedMonth('2026-08', 'America/Sao_Paulo')).toBe('2026-08')
  })
})

describe('monthRange — filtro por mês (julho não vaza pra agosto e vice-versa)', () => {
  it('separa lançamentos de julho e agosto', () => {
    const august = monthRange('2026-08')
    const july = monthRange('2026-07')
    const records = [
      { id: 'jul-30', date: '2026-07-30' },
      { id: 'jul-31', date: '2026-07-31' },
      { id: 'aug-01', date: '2026-08-01' },
      { id: 'aug-31', date: '2026-08-31' },
      { id: 'sep-01', date: '2026-09-01' },
    ]

    const inAugust = records.filter((r) => r.date >= august.start && r.date < august.nextStart)
    expect(inAugust.map((r) => r.id)).toEqual(['aug-01', 'aug-31'])
    expect(inAugust.some((r) => r.id.startsWith('jul'))).toBe(false)

    const inJuly = records.filter((r) => r.date >= july.start && r.date < july.nextStart)
    expect(inJuly.map((r) => r.id)).toEqual(['jul-30', 'jul-31'])
    expect(inJuly.some((r) => r.id.startsWith('aug'))).toBe(false)
  })

  it('lida com virada de ano', () => {
    const december = monthRange('2026-12')
    expect(december.start).toBe('2026-12-01')
    expect(december.nextStart).toBe('2027-01-01')
  })
})

describe('shiftMonth', () => {
  it('avança e volta mês, inclusive virando o ano', () => {
    expect(shiftMonth('2026-08', 1)).toBe('2026-09')
    expect(shiftMonth('2026-08', -1)).toBe('2026-07')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })
})

describe('resolveMonthSelection', () => {
  it('"all" é preservado literalmente (visão de todo o histórico)', () => {
    expect(resolveMonthSelection('all', 'America/Sao_Paulo')).toBe('all')
  })

  it('mês válido e inválido se comportam igual a resolveSelectedMonth', () => {
    expect(resolveMonthSelection('2026-07', 'America/Sao_Paulo')).toBe('2026-07')
    expect(resolveMonthSelection('lixo', 'America/Sao_Paulo')).toMatch(/^\d{4}-\d{2}$/)
    expect(resolveMonthSelection(undefined, 'America/Sao_Paulo')).toMatch(/^\d{4}-\d{2}$/)
  })
})

describe('mostRecentMonth', () => {
  it('escolhe o mês mais recente entre datas de fontes diferentes', () => {
    expect(mostRecentMonth(['2026-07-15', '2026-05-02', null, undefined])).toBe('2026-07')
    expect(mostRecentMonth(['2026-01-31', '2026-12-01'])).toBe('2026-12')
  })

  it('sem nenhuma data válida devolve null', () => {
    expect(mostRecentMonth([null, undefined])).toBeNull()
    expect(mostRecentMonth([])).toBeNull()
  })
})

describe('defaultDateForMonth', () => {
  it('usa hoje quando o mês selecionado é o mês atual', () => {
    const now = new Date()
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const result = defaultDateForMonth(monthKey, 'UTC')
    expect(result.slice(0, 7)).toBe(monthKey)
  })

  it('cai dentro do mês selecionado quando é um mês passado', () => {
    const result = defaultDateForMonth('2026-02', 'UTC')
    expect(result.slice(0, 7)).toBe('2026-02')
    const day = Number(result.slice(8, 10))
    expect(day).toBeGreaterThanOrEqual(1)
    expect(day).toBeLessThanOrEqual(28)
  })
})
