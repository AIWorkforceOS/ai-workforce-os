import { describe, expect, it } from 'vitest'
import { cleanAnalysis } from '../demand-analysis'

describe('cleanAnalysis', () => {
  it('normaliza uma resposta boa', () => {
    const a = cleanAnalysis({ demand: ' Porta da loja não fecha ', materials: [{ item: 'Dobradiça', note: 'suposição' }, { item: '', note: 'x' }, 'lixo'], scope_idea: 'Ajustar a porta.', insufficient: false })
    expect(a).toEqual({ demandPt: 'Porta da loja não fecha', materials: [{ item: 'Dobradiça', note: 'suposição' }], scopeIdeaPt: 'Ajustar a porta.', insufficient: false })
  })
  it('marca insuficiente quando vem vazio ou o modelo diz que é vago', () => {
    expect(cleanAnalysis({}).insufficient).toBe(true)
    expect(cleanAnalysis(null).insufficient).toBe(true)
    expect(cleanAnalysis({ demand: 'x', insufficient: true }).insufficient).toBe(true)
  })
  it('limita itens e tamanho', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ item: `m${i}`, note: null }))
    expect(cleanAnalysis({ demand: 'd', materials: many }).materials).toHaveLength(8)
    expect(cleanAnalysis({ demand: 'a'.repeat(2000) }).demandPt).toHaveLength(600)
    expect(cleanAnalysis({ demand: 'null', materials: [{ item: 'null' }] }).insufficient).toBe(true)
  })
})
