import { describe, expect, it } from 'vitest'
import { humanizeFieldLabel, humanizeProfileValue, profileEntries } from '../profile-format'

describe('humanizeFieldLabel', () => {
  it('troca underscore por espaço e capitaliza a primeira letra', () => {
    expect(humanizeFieldLabel('politica_desconto')).toBe('Politica desconto')
    expect(humanizeFieldLabel('tipo_negocio')).toBe('Tipo negocio')
    expect(humanizeFieldLabel('observacoes')).toBe('Observacoes')
  })
})

describe('humanizeProfileValue', () => {
  it('formata booleanos como Sim/Não', () => {
    expect(humanizeProfileValue(true)).toBe('Sim')
    expect(humanizeProfileValue(false)).toBe('Não')
  })

  it('formata null/undefined como travessão', () => {
    expect(humanizeProfileValue(null)).toBe('—')
    expect(humanizeProfileValue(undefined)).toBe('—')
  })

  it('junta arrays simples com vírgula', () => {
    expect(humanizeProfileValue(['segunda', 'terça', 'quarta'])).toBe('segunda, terça, quarta')
  })

  it('array vazio vira travessão', () => {
    expect(humanizeProfileValue([])).toBe('—')
  })

  it('formata array de objetos (ex.: produtos) recursivamente, sem JSON cru', () => {
    const value = [{ nome: 'Plano Básico', preco: 'R$ 99' }]
    const out = humanizeProfileValue(value)
    expect(out).not.toContain('{')
    expect(out).toContain('Nome: Plano Básico')
    expect(out).toContain('Preco: R$ 99')
  })

  it('array de VÁRIOS objetos numera cada item — achado ao vivo em produção: sem isso virava um parágrafo corrido sem indicar onde um produto termina e o outro começa', () => {
    const value = [
      { nome: 'Plano Básico', preco: 'R$ 99' },
      { nome: 'Plano Pro', preco: 'R$ 199' },
      { nome: 'Plano Enterprise', preco: 'sob consulta' },
    ]
    const out = humanizeProfileValue(value)
    expect(out).toContain('1) Nome: Plano Básico, Preco: R$ 99')
    expect(out).toContain('2) Nome: Plano Pro, Preco: R$ 199')
    expect(out).toContain('3) Nome: Plano Enterprise, Preco: sob consulta')
  })

  it('números e strings simples viram String() direto', () => {
    expect(humanizeProfileValue(42)).toBe('42')
    expect(humanizeProfileValue('São Paulo')).toBe('São Paulo')
  })
})

describe('profileEntries', () => {
  it('retorna lista vazia para perfil nulo/vazio', () => {
    expect(profileEntries(null)).toEqual([])
    expect(profileEntries(undefined)).toEqual([])
    expect(profileEntries({})).toEqual([])
  })

  it('omite campos vazios (string vazia, array vazio, objeto vazio, null)', () => {
    const entries = profileEntries({
      tipo_negocio: 'clínica',
      observacoes: [],
      politica_desconto: '',
      extra: null,
    })
    expect(entries).toEqual([{ label: 'Tipo negocio', value: 'clínica' }])
  })

  it('NUNCA expõe campos internos org_* — pertencem à Ficha da Empresa compartilhada, não à ficha do funcionário', () => {
    const entries = profileEntries({
      tipo_negocio: 'clínica',
      org_vertical_key: 'medical_clinic',
      org_vertical_confirmed: true,
      org_company_name: 'Clínica Exemplo',
      org_intake_started: true,
    })
    expect(entries).toEqual([{ label: 'Tipo negocio', value: 'clínica' }])
  })

  it('ordena alfabeticamente pelo label', () => {
    const entries = profileEntries({ regiao: 'SP', cargos_tipicos: ['dev'], tipo_negocio: 'clínica' })
    expect(entries.map((e) => e.label)).toEqual(['Cargos tipicos', 'Regiao', 'Tipo negocio'])
  })
})
