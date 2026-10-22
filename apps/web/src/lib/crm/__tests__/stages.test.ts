import { describe, expect, it } from 'vitest'
import { canDeleteStage, columnKeyOf, columnsFrom, DEFAULT_STAGES, neighborColumn, validateStageSet, type StageRow } from '../stages'

const rows: StageRow[] = [
  { id: 'a', name: 'Prospecção', kind: 'new', color: 'slate', position: 0 },
  { id: 'b', name: 'Visita técnica', kind: 'negotiating', color: 'purple', position: 2 },
  { id: 'c', name: 'Proposta enviada', kind: 'negotiating', color: 'cyan', position: 1 },
  { id: 'd', name: 'Fechado', kind: 'won', color: 'green', position: 3 },
  { id: 'e', name: 'Descartado', kind: 'lost', color: 'red', position: 4 },
]

describe('columnsFrom', () => {
  it('sem etapas da empresa = o funil padrão de 6, igual a hoje', () => {
    const c = columnsFrom([])
    expect(c.map((x) => x.key)).toEqual(['new', 'contacted', 'replied', 'negotiating', 'won', 'lost'])
    expect(c).toHaveLength(DEFAULT_STAGES.length)
    expect(columnsFrom(null)).toHaveLength(6)
  })
  it('com etapas: ordem pela posição', () => {
    expect(columnsFrom(rows).map((x) => x.label)).toEqual(['Prospecção', 'Proposta enviada', 'Visita técnica', 'Fechado', 'Descartado'])
  })
})

describe('columnKeyOf', () => {
  const cols = columnsFrom(rows)
  it('usa a etapa escolhida quando combina com o status', () => {
    expect(columnKeyOf({ status: 'negotiating', stage_id: 'b' }, cols)).toBe('b')
  })
  it('lead antigo (sem etapa) cai na primeira etapa do comportamento do status', () => {
    expect(columnKeyOf({ status: 'negotiating', stage_id: null }, cols)).toBe('c')
    expect(columnKeyOf({ status: 'new' }, cols)).toBe('a')
  })
  it('agente mudou o status sozinho: a etapa antiga deixa de valer, sem lead preso', () => {
    expect(columnKeyOf({ status: 'won', stage_id: 'b' }, cols)).toBe('d')
  })
  it('status sem etapa correspondente cai na primeira coluna (nunca some)', () => {
    expect(columnKeyOf({ status: 'replied', stage_id: null }, cols)).toBe('a')
  })
  it('no funil padrão o lead cai na coluna do status', () => {
    expect(columnKeyOf({ status: 'replied' }, columnsFrom([]))).toBe('replied')
  })
})

describe('neighborColumn', () => {
  const cols = columnsFrom(rows)
  it('anda na ordem do quadro e para nas pontas', () => {
    expect(neighborColumn('a', cols, 1)?.key).toBe('c')
    expect(neighborColumn('c', cols, -1)?.key).toBe('a')
    expect(neighborColumn('a', cols, -1)).toBeNull()
    expect(neighborColumn('e', cols, 1)).toBeNull()
    expect(neighborColumn('zzz', cols, 1)).toBeNull()
  })
})

describe('validateStageSet / canDeleteStage', () => {
  it('exige nome único e etapas Novo, Convertido e Perdido', () => {
    expect(validateStageSet(rows)).toBeNull()
    expect(validateStageSet([])).toBeNull()
    expect(validateStageSet([...rows, { name: ' prospecção ', kind: 'new' }])).toMatch(/Já existe/)
    expect(validateStageSet([{ name: '  ', kind: 'new' }])).toMatch(/nome/)
    expect(validateStageSet(rows.filter((r) => r.kind !== 'won'))).toMatch(/Convertido/)
    expect(validateStageSet(rows.filter((r) => r.kind !== 'lost'))).toMatch(/Perdido/)
    expect(validateStageSet(rows.filter((r) => r.kind !== 'new'))).toMatch(/Novo/)
    expect(validateStageSet([{ name: 'x'.repeat(41), kind: 'new' }])).toMatch(/40/)
  })
  it('não deixa apagar a única etapa essencial', () => {
    expect(canDeleteStage(rows, 'd')).toMatch(/Convertido/)
    expect(canDeleteStage(rows, 'b')).toBeNull() // há outra Negociando
    expect(canDeleteStage(rows, 'c')).toBeNull()
    expect(canDeleteStage([{ id: 'a', kind: 'new' }], 'a')).toMatch(/ao menos uma/)
  })
})
