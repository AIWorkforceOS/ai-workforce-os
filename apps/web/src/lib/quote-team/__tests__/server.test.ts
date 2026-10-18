import { describe, expect, it, vi } from 'vitest'
import { diagnosisMediaUrls, maybeEnqueueQuoteAnalysis } from '../server'

describe('diagnosisMediaUrls', () => {
  it('só fotos antes/depois/atendimento; vídeo e nota fiscal ficam de fora', () => {
    expect(diagnosisMediaUrls([{ url: 'a', kind: 'before' }, { url: 'b', kind: 'after' }, { url: 'c' }, { url: 'd', kind: 'video' }, { url: 'e', kind: 'material_invoice' }])).toEqual(['a', 'b', 'c'])
    expect(diagnosisMediaUrls(null)).toEqual([])
  })
})

describe('maybeEnqueueQuoteAnalysis (Fase 2: inerte)', () => {
  it('sem etapas registradas não consulta o banco e não cria nada — o salvamento segue exatamente como hoje', async () => {
    const from = vi.fn()
    const result = await maybeEnqueueQuoteAnalysis({ from } as never, { unitId: 'u', appointmentId: 'a', orderStatus: 'quote', notes: 'porta', photos: [] })
    expect(result).toEqual({ status: 'skipped', reason: 'pipeline_not_ready' })
    expect(from).not.toHaveBeenCalled()
  })
})
