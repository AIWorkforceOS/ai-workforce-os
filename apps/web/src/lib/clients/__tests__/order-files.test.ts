import { describe, expect, it } from 'vitest'
import { summarizeOrderFiles, totalsOf } from '../order-files'

const base = { photos: [], fileUrl: null, fileName: null, status: 'pending', signedAt: null, reportToken: null }

describe('summarizeOrderFiles', () => {
  it('conta fotos por tipo', () => {
    const f = summarizeOrderFiles({ ...base, photos: [{ url: 'a', kind: 'before' }, { url: 'b', kind: 'after' }, { url: 'c' }, { url: 'd', kind: 'service' }, { url: 'e', kind: 'material_invoice' }, { url: 'f', kind: 'video' }] })
    expect(f.photoCounts).toEqual({ before: 1, after: 1, other: 2, receipts: 1, videos: 1 })
    expect(f.photoTotal).toBe(6)
    expect(f.hasPhotoReport).toBe(true)
  })
  it('Sign Off só com ordem assinada e concluída/cotação', () => {
    expect(summarizeOrderFiles({ ...base, status: 'completed', signedAt: '2026-10-01' }).hasSignOff).toBe(true)
    expect(summarizeOrderFiles({ ...base, status: 'quote', signedAt: '2026-10-01' }).hasSignOff).toBe(true)
    expect(summarizeOrderFiles({ ...base, status: 'completed' }).hasSignOff).toBe(false)
    expect(summarizeOrderFiles({ ...base, status: 'pending', signedAt: '2026-10-01' }).hasSignOff).toBe(false)
  })
  it('ordem original e totais', () => {
    const a = summarizeOrderFiles({ ...base, fileUrl: 'https://x/y.pdf' })
    expect(a.original).toEqual({ url: 'https://x/y.pdf', name: 'Ordem original' })
    const b = summarizeOrderFiles({ ...base, photos: [{ url: 'a' }], status: 'completed', signedAt: 'x' })
    expect(totalsOf([a, b])).toEqual({ orders: 2, withSignOff: 1, withPhotos: 1, photos: 1 })
  })
})
