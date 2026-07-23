import { describe, expect, it } from 'vitest'
import {
  isRecurringService,
  monthlyOccurrenceMultiplier,
  normalizeServiceRecurrence,
  projectedMonthlyRevenue,
} from '@/lib/scheduling/service-recurrence'

describe('normalizeServiceRecurrence', () => {
  it('lê o formato antigo (string, migration 032)', () => {
    expect(normalizeServiceRecurrence('weekly')).toEqual({ type: 'weekly' })
    expect(normalizeServiceRecurrence('once')).toEqual({ type: 'once' })
    expect(normalizeServiceRecurrence('lixo')).toEqual({ type: 'once' })
  })

  it('lê o formato novo (objeto, migration 035)', () => {
    expect(normalizeServiceRecurrence({ type: 'monthly' })).toEqual({ type: 'monthly' })
    expect(normalizeServiceRecurrence({ type: 'custom', days: ['mon', 'thu'] })).toEqual({
      type: 'custom',
      days: ['mon', 'thu'],
    })
  })

  it('custom sem dias válidos cai pra ["mon"]', () => {
    expect(normalizeServiceRecurrence({ type: 'custom', days: ['lixo'] })).toEqual({ type: 'custom', days: ['mon'] })
    expect(normalizeServiceRecurrence({ type: 'custom' })).toEqual({ type: 'custom', days: ['mon'] })
  })

  it('valores ausentes ou malformados caem pra once', () => {
    expect(normalizeServiceRecurrence(null)).toEqual({ type: 'once' })
    expect(normalizeServiceRecurrence(undefined)).toEqual({ type: 'once' })
    expect(normalizeServiceRecurrence(42)).toEqual({ type: 'once' })
  })
})

describe('isRecurringService', () => {
  it('once não é recorrente; os demais são', () => {
    expect(isRecurringService({ type: 'once' })).toBe(false)
    expect(isRecurringService({ type: 'weekly' })).toBe(true)
    expect(isRecurringService({ type: 'custom', days: ['mon'] })).toBe(true)
  })
})

describe('monthlyOccurrenceMultiplier / projectedMonthlyRevenue', () => {
  it('segue a convenção do Vinicius: semanal = 4x/mês', () => {
    expect(monthlyOccurrenceMultiplier({ type: 'weekly' })).toBe(4)
    expect(projectedMonthlyRevenue(80, { type: 'weekly' })).toBe(320)
  })

  it('quinzenal = 2x/mês, mensal = 1x/mês', () => {
    expect(monthlyOccurrenceMultiplier({ type: 'biweekly' })).toBe(2)
    expect(monthlyOccurrenceMultiplier({ type: 'monthly' })).toBe(1)
    expect(projectedMonthlyRevenue(100, { type: 'biweekly' })).toBe(200)
    expect(projectedMonthlyRevenue(100, { type: 'monthly' })).toBe(100)
  })

  it('personalizado = 4x × número de dias por semana', () => {
    expect(monthlyOccurrenceMultiplier({ type: 'custom', days: ['mon', 'thu'] })).toBe(8)
    expect(projectedMonthlyRevenue(80, { type: 'custom', days: ['mon', 'thu'] })).toBe(640)
  })

  it('serviço único ou sem valor não entra na projeção', () => {
    expect(projectedMonthlyRevenue(150, { type: 'once' })).toBe(0)
    expect(projectedMonthlyRevenue(null, { type: 'weekly' })).toBe(0)
    expect(projectedMonthlyRevenue(0, { type: 'weekly' })).toBe(0)
    expect(projectedMonthlyRevenue(-10, { type: 'weekly' })).toBe(0)
  })
})
