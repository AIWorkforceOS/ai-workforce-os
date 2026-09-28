import { describe, expect, it } from 'vitest'
import { growthPercent } from '../monthly-growth'

// growthPercent (2026-09-27, pedido do Vinicius): "o quanto cresceu
// referente ao último mês" — mesma fórmula/guarda de pctChange já
// existente em lib/traffic/metrics.ts, aplicada ao domínio financeiro.

describe('growthPercent', () => {
  it('crescimento positivo: mês atual maior que o anterior', () => {
    expect(growthPercent(1500, 1000)).toBeCloseTo(50)
  })

  it('crescimento negativo: mês atual menor que o anterior', () => {
    expect(growthPercent(800, 1000)).toBeCloseTo(-20)
  })

  it('sem variação: os dois meses iguais', () => {
    expect(growthPercent(1000, 1000)).toBe(0)
  })

  it('mês anterior zero: não computável, nunca divide por zero', () => {
    expect(growthPercent(500, 0)).toBeNull()
  })

  it('mês anterior null (sem histórico): não computável', () => {
    expect(growthPercent(500, null)).toBeNull()
  })
})
