import { beforeEach, describe, expect, it, vi } from 'vitest'

const addPendingSave = vi.fn()
const listPendingSaves = vi.fn()
const drainPendingSaves = vi.fn().mockResolvedValue({ synced: 0, failed: 0, remaining: 0 })
vi.mock('../offline-store', () => ({
  addPendingSave: (...a: unknown[]) => addPendingSave(...a),
  listPendingSaves: () => listPendingSaves(),
  localId: () => 'local-1',
}))
vi.mock('../offline-sync', () => ({ drainPendingSaves: (...a: unknown[]) => drainPendingSaves(...a) }))

import { loadPendingFieldEvents, recordFieldEvent } from '../field-events'

beforeEach(() => {
  addPendingSave.mockReset().mockResolvedValue('local-1')
  listPendingSaves.mockReset()
  drainPendingSaves.mockClear()
})

describe('recordFieldEvent', () => {
  it('guarda no aparelho primeiro (com posição) e só então manda sincronizar', async () => {
    const fix = { lat: 25.77, lng: -80.19, accuracy: 12, at: '2026-10-17T10:00:00Z' }
    const result = await recordFieldEvent({ unitId: 'u', appointmentId: 'a', type: 'trip_start', fix })
    expect(result.stored).toBe(true)
    const saved = addPendingSave.mock.calls[0]![0]
    expect(saved.fields).toMatchObject({ __event: 'trip_start', lat: '25.77', lng: '-80.19', accuracy: '12' })
    expect(saved.files).toEqual({})
    expect(addPendingSave.mock.invocationCallOrder[0]!).toBeLessThan(drainPendingSaves.mock.invocationCallOrder[0]!)
  })
  it('sem espaço local → stored=false e não tenta enviar', async () => {
    addPendingSave.mockResolvedValue(null)
    expect((await recordFieldEvent({ unitId: 'u', appointmentId: 'a', type: 'check_in', fix: null })).stored).toBe(false)
    expect(drainPendingSaves).not.toHaveBeenCalled()
  })
})

describe('loadPendingFieldEvents', () => {
  it('reconstrói o estado a partir da fila, só deste agendamento', async () => {
    listPendingSaves.mockResolvedValue([
      { appointmentId: 'a', createdAt: 1, fields: { __event: 'trip_start', at: '2026-10-17T10:00:00Z' } },
      { appointmentId: 'a', createdAt: 2, fields: { __event: 'check_in', at: '2026-10-17T10:30:00Z' } },
      { appointmentId: 'b', createdAt: 3, fields: { __event: 'trip_start', at: '2026-10-17T09:00:00Z' } },
      { appointmentId: 'a', createdAt: 4, fields: { status: 'completed' } },
    ])
    expect(await loadPendingFieldEvents('a')).toEqual({ trip_started_at: '2026-10-17T10:00:00Z', checked_in_at: '2026-10-17T10:30:00Z' })
  })
})

describe('registro sem GPS', () => {
  it('sem posição, o marco é guardado mesmo assim com a marca no_gps (o admin enxerga)', async () => {
    await recordFieldEvent({ unitId: 'u', appointmentId: 'a', type: 'check_in', fix: null })
    const saved = addPendingSave.mock.calls.at(-1)![0]
    expect(saved.fields).toMatchObject({ __event: 'check_in', no_gps: '1' })
    expect(saved.fields.lat).toBeUndefined()
  })
})
