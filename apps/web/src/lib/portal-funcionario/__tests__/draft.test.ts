import { describe, expect, it } from 'vitest'
import { isDraftWorthSaving, type DraftFields } from '../draft'

const server: DraftFields = { status: 'completed', signedBy: '', partPurchaseLink: '', materialDescription: '', materialValue: '', hoursNeeded: '' }

describe('isDraftWorthSaving', () => {
  it('tela recém-aberta, nada mudou: não grava rascunho vazio', () => {
    expect(isDraftWorthSaving({ current: server, serverValues: server, fileCount: 0, hasSignature: false })).toBe(false)
  })
  it('foto nova ou assinatura nova: grava', () => {
    expect(isDraftWorthSaving({ current: server, serverValues: server, fileCount: 1, hasSignature: false })).toBe(true)
    expect(isDraftWorthSaving({ current: server, serverValues: server, fileCount: 0, hasSignature: true })).toBe(true)
  })
  it('campo de texto alterado: grava', () => {
    expect(isDraftWorthSaving({ current: { ...server, signedBy: 'Maria' }, serverValues: server, fileCount: 0, hasSignature: false })).toBe(true)
  })
})
