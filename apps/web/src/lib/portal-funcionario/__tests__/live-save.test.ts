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
    listPendingSaves.mockResolvedValue([{ id: 'i1', status: 'waiting', lastError: 'network', files: {}, createdAt: 1, appointmentId: 'a' }])
    expect(await saveViaQueue(input)).toEqual({ kind: 'queued', label: 'Aguardando internet' })
  })
  it('sessão expirada NÃO é descrita como falta de internet', async () => {
    listPendingSaves.mockResolvedValue([{ id: 'i1', status: 'waiting', lastError: 'session', files: {}, createdAt: 1, appointmentId: 'a' }])
    const result = await saveViaQueue(input)
    expect(result).toMatchObject({ kind: 'queued' })
    expect((result as { label: string }).label).toMatch(/Sessão expirada/)
    expect((result as { label: string }).label).not.toMatch(/internet/i)
  })
  it('item failed → failed com a mensagem, continua guardado', async () => {
    listPendingSaves.mockResolvedValue([{ id: 'i1', status: 'failed', lastError: 'recusado' }])
    expect(await saveViaQueue(input)).toEqual({ kind: 'failed', message: 'recusado' })
  })
})

describe('saveViaQueue — pista própria e retomada', () => {
  it('usa a pista "default": o Sign Off não espera um vídeo grande que esteja subindo', async () => {
    listPendingSaves.mockResolvedValue([])
    await saveViaQueue(input)
    expect(drainPendingSaves).toHaveBeenCalledWith({ force: true, lane: 'default' })
  })
  it('uma sincronização que já rodava não pegou o item (nunca tentado): roda de novo uma vez', async () => {
    listPendingSaves.mockResolvedValue([{ id: 'i1', status: 'pending', files: {}, createdAt: 1, appointmentId: 'a' }])
    await saveViaQueue(input)
    expect(drainPendingSaves).toHaveBeenCalledTimes(2)
  })
  it('item já tentado (em espera por rede/servidor): NÃO insiste, informa que está guardado', async () => {
    listPendingSaves.mockResolvedValue([{ id: 'i1', status: 'pending', attempts: 1, lastError: 'network', files: {}, createdAt: 1, appointmentId: 'a' }])
    const result = await saveViaQueue(input)
    expect(drainPendingSaves).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ kind: 'queued' })
  })
})
