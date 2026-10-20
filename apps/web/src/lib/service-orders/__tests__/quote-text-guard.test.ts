import { describe, expect, it } from 'vitest'
import { stripMissingInfoStatements } from '../quote-text-guard'

describe('cotação nunca fala de informação que faltou', () => {
  it('remove as frases reais encontradas nas cotações de produção (inglês e português)', () => {
    const en = 'Found 5 covers that have fallen.\n\nNecessary:\n- Reinstall 5 covers\n\nEstimated cost and time are not provided.\n\nPlease approve the quote to proceed.'
    const pt = 'Encontradas 5 capas.\n\nNecessário:\n- Reinstalar 5 capas\n\nEstimativa de custo e prazo não foram fornecidos.\n\nAprovar a cotação para prosseguir.'
    expect(stripMissingInfoStatements(en)).toBe('Found 5 covers that have fallen.\n\nNecessary:\n- Reinstall 5 covers\n\nPlease approve the quote to proceed.')
    expect(stripMissingInfoStatements(pt)).toBe('Encontradas 5 capas.\n\nNecessário:\n- Reinstalar 5 capas\n\nAprovar a cotação para prosseguir.')
    expect(stripMissingInfoStatements('Model THY31C.\n\nNo cost or time estimates were provided.\n\nApproval requested.')).toBe('Model THY31C.\n\nApproval requested.')
    expect(stripMissingInfoStatements('Modelo THY31C.\n\nNão foram fornecidos custos ou estimativas de tempo.\n\nAprovação solicitada.')).toBe('Modelo THY31C.\n\nAprovação solicitada.')
  })
  it('outras redações do mesmo tipo também saem', () => {
    for (const phrase of [
      'Cost estimate was not provided.',
      'The price is not available.',
      'No timeline was given.',
      'Custo não informado.',
      'O prazo não foi informado.',
      'Sem estimativa de custo.',
      'Nenhum prazo foi especificado.',
    ]) {
      expect(stripMissingInfoStatements(`Reinstalar a porta. ${phrase} Aprovar.`)).toBe('Reinstalar a porta. Aprovar.')
    }
  })
  it('NÃO remove custo/tempo que foram informados nem outras frases com "não"', () => {
    const keep = [
      'Estimated labor time is 2 hours.',
      'O tempo estimado de mão de obra é de 2 horas.',
      'The estimated material cost is US$ 45.90.',
      'It was not available at the current location.',
      'Não estava disponível no local atual.',
      'The door does not close properly.',
      'Labor: 2 technicians for 1 hour.',
    ]
    for (const text of keep) expect(stripMissingInfoStatements(text)).toBe(text)
  })
  it('preserva o resto da linha quando só uma frase é removida', () => {
    expect(stripMissingInfoStatements('Two technicians are needed for 1 hour. Cost is not provided. Please approve.')).toBe('Two technicians are needed for 1 hour. Please approve.')
  })
})
