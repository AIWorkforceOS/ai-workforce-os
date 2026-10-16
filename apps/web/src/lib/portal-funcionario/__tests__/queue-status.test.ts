import { describe, expect, it } from 'vitest'
import { describeQueueItem } from '../queue-status'

const base = { id: 'i', unitId: 'u', appointmentId: 'a', createdAt: 1, fields: {}, files: { photosBefore: [{ blob: new Blob([new Uint8Array(1048576)]), name: 'a.jpg', type: 'image/jpeg' }] } }

describe('describeQueueItem', () => {
  it('item novo: salvo no aparelho, aguardando envio', () => {
    expect(describeQueueItem(base)).toMatchObject({ state: 'waiting', fileCount: 1, megabytes: 1, label: 'Salvo no aparelho — aguardando envio' })
  })
  it('sessão expirada: diz que nada foi perdido', () => {
    expect(describeQueueItem({ ...base, lastError: 'session', attempts: 2 }).label).toContain('nada foi perdido')
  })
  it('falha definitiva: continua guardado e o texto avisa que não foi apagado', () => {
    const view = describeQueueItem({ ...base, status: 'failed', lastHttpStatus: 404 })
    expect(view.state).toBe('failed')
    expect(view.label).toContain('não foi apagado')
  })
})
