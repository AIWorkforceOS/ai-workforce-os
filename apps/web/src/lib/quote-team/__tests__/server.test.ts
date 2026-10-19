import { describe, expect, it } from 'vitest'
import { diagnosisMediaUrls } from '../server'

describe('diagnosisMediaUrls', () => {
  it('usa só fotos (antes/depois/atendimento); vídeo e nota fiscal ficam de fora', () => {
    const urls = diagnosisMediaUrls([
      { url: 'a', kind: 'before' },
      { url: 'b', kind: 'after' },
      { url: 'c' },
      { url: 'd', kind: 'service' },
      { url: 'v', kind: 'video' },
      { url: 'n', kind: 'material_invoice' },
    ])
    expect(urls).toEqual(['a', 'b', 'c', 'd'])
  })
  it('lista vazia ou nula', () => {
    expect(diagnosisMediaUrls(null)).toEqual([])
    expect(diagnosisMediaUrls(undefined)).toEqual([])
  })
})
