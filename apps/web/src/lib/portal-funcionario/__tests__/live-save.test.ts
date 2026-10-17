import { beforeEach, describe, expect, it, vi } from 'vitest'

const addPendingSave = vi.fn()
const listPendingSaves = vi.fn()
const drainPendingSaves = vi.fn()
vi.mock('../offline-store', () => ({ addPendingSave: (...a: unknown[]) => addPendingSave(...a), listPendingSaves: () => listPendingSaves() }))
vi.mock('../offline-sync', () => ({ drainPendingSaves: (...a: unknown[]) => drainPendingSaves(...a) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { service_order_status: 'completed' } }) }) }) }) }),
}))

import { saveViaQueue } from '../live-save'

const input = { id: 'i1', unitId: 'u', appointmentId: 'a', fields: {}, files: {} }

beforeEach(() => {
  addPendingSave.mockReset().mockResolvedValue('i1')
  listPendingSaves.mockReset()
  drainPendingSaves.mockReset().mockResolvedValue({ synced: 0, failed: 0, remaining: 0 })
})

describe('saveViaQueue', () => {
  it('não conseguiu guardar localmente → not_stored e não tenta enviar', async () => {
    addPendingSave.mockResolvedValue(null)
    expect(await saveViaQueue(input)).toEqual({ kind: 'not_stored' })
    expect(drainPendingSaves).not.toHaveBeenCalled()
  })
  it('guarda primeiro, envia, e só vira synced quando o item saiu da fila', async () => {
    listPendingSaves.mockResolvedValue([])
    const result = await saveViaQueue(input)
    expect(addPendingSave.mock.invocationCallOrder[0]!).toBeLessThan(drainPendingSaves.mock.invocationCallOrder[0]!)
    expect(result).toEqual({ kind: 'synced', patch: { service_order_status: 'completed' } })
  })
  it('item ainda na fila → queued (nada perdido)', async () => {
    listPendingSaves.mockResolvedValue([{ id: 'i1', status: 'waiting' }])
    expect(await saveViaQueue(input)).toEqual({ kind: 'queued' })
  })
  it('item failed → failed com a mensagem, continua guardado', async () => {
    listPendingSaves.mockResolvedValue([{ id: 'i1', status: 'failed', lastError: 'recusado' }])
    expect(await saveViaQueue(input)).toEqual({ kind: 'failed', message: 'recusado' })
  })
})
