import { describe, expect, it } from 'vitest'
import { slugBase } from '../unit-provisioning'

describe('partner unit provisioning', () => {
  it('gera base de slug estável a partir do nome', () => {
    expect(slugBase('Smarter São José — Centro')).toBe('smarter-sao-jose-centro')
  })
  it('não devolve slug vazio', () => {
    expect(slugBase('---')).toBe('unidade')
  })
})
