import { describe, expect, it } from 'vitest'
import { itemsTotal, lineTotal, parseQuoteItems, quoteTotals, validateQuoteItems } from '../quote'

describe('quote items', () => {
  it('soma linhas com centavos sem erro de ponto flutuante', () => {
    expect(lineTotal({ quantity: 3, unitPrice: 0.1 })).toBe(0.3)
    expect(itemsTotal([{ description: 'a', quantity: 2, unitPrice: 19.99 }, { description: 'b', quantity: 1, unitPrice: 5.05 }])).toBe(45.03)
  })
  it('lê custom_fields com tolerância', () => {
    expect(parseQuoteItems(null)).toEqual([])
    expect(parseQuoteItems({ quote_items: 'x' })).toEqual([])
    expect(parseQuoteItems({ quote_items: [{ description: ' Exit sign ', quantity: 2, unitPrice: '30.5' }, { description: '', quantity: 1, unitPrice: 1 }, { description: 'bad', quantity: -1, unitPrice: 1 }, null] })).toEqual([{ description: 'Exit sign', quantity: 2, unitPrice: 30.5 }])
  })
  it('valida o que o escritório digitou', () => {
    expect(validateQuoteItems([{ description: 'Hinge', quantity: '4', unitPrice: '$12.50' }, { description: '', quantity: '', unitPrice: '' }])).toEqual({ ok: true, items: [{ description: 'Hinge', quantity: 4, unitPrice: 12.5 }] })
    expect(validateQuoteItems([{ description: '', quantity: '1', unitPrice: '1' }])).toMatchObject({ ok: false })
    expect(validateQuoteItems([{ description: 'x', quantity: '0', unitPrice: '1' }])).toMatchObject({ ok: false })
    expect(validateQuoteItems([{ description: 'x', quantity: '1', unitPrice: '-1' }])).toMatchObject({ ok: false })
  })
  it('totais: linhas mandam; sem linhas usa o valor informado; compara com o aprovado', () => {
    const items = [{ description: 'a', quantity: 2, unitPrice: 100 }]
    expect(quoteTotals({ items, materialValue: 999, hoursNeeded: 8, approvedAmount: 150, approvedHours: 6 })).toEqual({ materials: 200, hours: 8, hasItems: true, overApprovedAmount: 50, overApprovedHours: 2 })
    expect(quoteTotals({ items: [], materialValue: 120.5, hoursNeeded: null, approvedAmount: null, approvedHours: null })).toEqual({ materials: 120.5, hours: null, hasItems: false, overApprovedAmount: null, overApprovedHours: null })
    expect(quoteTotals({ items: [], materialValue: null, hoursNeeded: 2, approvedAmount: 100, approvedHours: 4 }).overApprovedAmount).toBe(-100)
  })
})
