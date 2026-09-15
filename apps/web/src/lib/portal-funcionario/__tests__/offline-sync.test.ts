import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// drainPendingSaves (2026-09-15, pedido do Vinicius): reenvia salvamentos
// guardados localmente por falta de internet — 'retry' (falha de rede)
// mantém na fila, 'synced'/'dropped' (rede respondeu, com sucesso ou
// rejeição real) sempre removem, pra fila nunca crescer sem fim com
// tentativas que nunca vão dar certo.

const listPendingSaves = vi.fn()
const deletePendingSave = vi.fn()

vi.mock('../offline-store', () => ({ listPendingSaves, deletePendingSave }))

function makeItem(overrides: Partial<{ id: string; unitId: string; appointmentId: string }> = {}) {
  return {
    id: 'item-1',
    unitId: 'unit-1',
    appointmentId: 'appt-1',
    createdAt: Date.now(),
    fields: { status: 'completed', signedBy: 'Maria' },
    files: { photosBefore: [{ blob: new Blob(['x']), name: 'foto.jpg', type: 'image/jpeg' }] },
    ...overrides,
  }
}

describe('drainPendingSaves', () => {
  beforeEach(() => {
    vi.resetModules()
    listPendingSaves.mockReset()
    deletePendingSave.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fila vazia: não chama fetch, devolve zeros', async () => {
    listPendingSaves.mockResolvedValue([])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { drainPendingSaves } = await import('../offline-sync')
    const result = await drainPendingSaves()

    expect(result).toEqual({ synced: 0, dropped: 0, remaining: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sincroniza com sucesso: bate a mesma rota PATCH de sempre e remove da fila', async () => {
    const item = makeItem()
    listPendingSaves.mockResolvedValueOnce([item]).mockResolvedValueOnce([])
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(url).toBe(`/api/units/${item.unitId}/appointments/${item.appointmentId}/service-order`)
      expect(init?.method).toBe('PATCH')
      const formData = init?.body as FormData
      expect(formData.get('status')).toBe('completed')
      expect(formData.get('signedBy')).toBe('Maria')
      expect((formData.getAll('photosBefore')[0] as File).name).toBe('foto.jpg')
      return { ok: true }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { drainPendingSaves } = await import('../offline-sync')
    const result = await drainPendingSaves()

    expect(result).toEqual({ synced: 1, dropped: 0, remaining: 0 })
    expect(deletePendingSave).toHaveBeenCalledWith(item.id)
  })

  it('sem internet (fetch lança): mantém na fila, não remove', async () => {
    const item = makeItem()
    listPendingSaves.mockResolvedValueOnce([item]).mockResolvedValueOnce([item])
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    const { drainPendingSaves } = await import('../offline-sync')
    const result = await drainPendingSaves()

    expect(result).toEqual({ synced: 0, dropped: 0, remaining: 1 })
    expect(deletePendingSave).not.toHaveBeenCalled()
  })

  it('servidor rejeita (rede chegou, mas erro real): remove da fila em vez de tentar pra sempre', async () => {
    const item = makeItem()
    listPendingSaves.mockResolvedValueOnce([item]).mockResolvedValueOnce([])
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))

    const { drainPendingSaves } = await import('../offline-sync')
    const result = await drainPendingSaves()

    expect(result).toEqual({ synced: 0, dropped: 1, remaining: 0 })
    expect(deletePendingSave).toHaveBeenCalledWith(item.id)
  })

  it('vários itens: continua tentando os seguintes mesmo se um falhar por rede', async () => {
    const itemA = makeItem({ id: 'a' })
    const itemB = makeItem({ id: 'b' })
    listPendingSaves.mockResolvedValueOnce([itemA, itemB]).mockResolvedValueOnce([itemA])
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1
        if (call === 1) throw new TypeError('Failed to fetch')
        return { ok: true }
      }),
    )

    const { drainPendingSaves } = await import('../offline-sync')
    const result = await drainPendingSaves()

    expect(result).toEqual({ synced: 1, dropped: 0, remaining: 1 })
    expect(deletePendingSave).toHaveBeenCalledTimes(1)
    expect(deletePendingSave).toHaveBeenCalledWith('b')
  })
})
