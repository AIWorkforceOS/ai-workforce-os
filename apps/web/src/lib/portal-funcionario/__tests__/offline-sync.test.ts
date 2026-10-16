import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// drainPendingSaves — etapa de confiabilidade (2026-10-16, pedido do
// Vinicius): "não podemos correr o risco de perder informações de uma WO
// por falha de internet, sessão expirada ou erro do servidor". Regra de
// ouro testada aqui: a fila só apaga um item quando o servidor confirma
// (2xx). Qualquer erro mantém o dado guardado.

const listPendingSaves = vi.fn()
const deletePendingSave = vi.fn()
const updatePendingSave = vi.fn()

vi.mock('../offline-store', () => ({ listPendingSaves, deletePendingSave, updatePendingSave }))

type Item = {
  id: string
  unitId: string
  appointmentId: string
  createdAt: number
  fields: Record<string, string>
  files: Record<string, { blob: Blob; name: string; type: string }[]>
  status?: 'pending' | 'failed'
  attempts?: number
  nextAttemptAt?: number
  sentFiles?: string[]
}

function makeItem(overrides: Partial<Item> = {}): Item {
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

const res = (status: number, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name: string) => headers[name] ?? null },
})

describe('drainPendingSaves', () => {
  beforeEach(() => {
    vi.resetModules()
    listPendingSaves.mockReset()
    deletePendingSave.mockReset()
    updatePendingSave.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('fila vazia: não chama fetch', async () => {
    listPendingSaves.mockResolvedValue([])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { drainPendingSaves } = await import('../offline-sync')
    expect(await drainPendingSaves()).toEqual({ synced: 0, failed: 0, remaining: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('2xx: bate a mesma rota PATCH, manda clientSaveId (idempotência) e só então apaga', async () => {
    const item = makeItem()
    listPendingSaves.mockResolvedValueOnce([item]).mockResolvedValueOnce([])
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(url).toBe('/api/units/unit-1/appointments/appt-1/service-order')
      expect(init?.method).toBe('PATCH')
      const form = init?.body as FormData
      expect(form.get('status')).toBe('completed')
      expect(form.get('clientSaveId')).toBe('item-1')
      expect((form.getAll('photosBefore')[0] as File).name).toBe('foto.jpg')
      return res(200)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { drainPendingSaves } = await import('../offline-sync')
    expect(await drainPendingSaves()).toEqual({ synced: 1, failed: 0, remaining: 0 })
    expect(deletePendingSave).toHaveBeenCalledWith('item-1')
  })

  it.each([
    ['sem internet (fetch lança)', null],
    ['sessão expirada (401)', 401],
    ['erro do servidor (500)', 500],
    ['gateway (502)', 502],
  ])('%s: NUNCA apaga, mantém na fila com backoff', async (_label, status) => {
    const item = makeItem()
    listPendingSaves.mockResolvedValueOnce([item]).mockResolvedValueOnce([item])
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (status === null) throw new TypeError('Failed to fetch')
      return res(status)
    }))
    const { drainPendingSaves } = await import('../offline-sync')
    const result = await drainPendingSaves()
    expect(result).toEqual({ synced: 0, failed: 0, remaining: 1 })
    expect(deletePendingSave).not.toHaveBeenCalled()
    expect(updatePendingSave).toHaveBeenCalledWith('item-1', expect.objectContaining({ status: 'pending', attempts: 1, nextAttemptAt: expect.any(Number) }))
  })

  it('429: respeita o Retry-After do servidor', async () => {
    const item = makeItem()
    listPendingSaves.mockResolvedValueOnce([item]).mockResolvedValueOnce([item])
    vi.stubGlobal('fetch', vi.fn(async () => res(429, { 'Retry-After': '90' })))
    const before = Date.now()
    const { drainPendingSaves } = await import('../offline-sync')
    await drainPendingSaves()
    const patch = updatePendingSave.mock.calls[0]![1] as { nextAttemptAt: number }
    expect(patch.nextAttemptAt).toBeGreaterThanOrEqual(before + 90_000)
  })

  it('recusa definitiva (404): marca como failed e MANTÉM guardado — nunca apaga sozinho', async () => {
    const item = makeItem()
    listPendingSaves.mockResolvedValueOnce([item]).mockResolvedValueOnce([item])
    vi.stubGlobal('fetch', vi.fn(async () => res(404)))
    const { drainPendingSaves } = await import('../offline-sync')
    const result = await drainPendingSaves()
    expect(result).toEqual({ synced: 0, failed: 1, remaining: 1 })
    expect(deletePendingSave).not.toHaveBeenCalled()
    expect(updatePendingSave).toHaveBeenCalledWith('item-1', expect.objectContaining({ status: 'failed', lastHttpStatus: 404 }))
  })

  it('item failed ou em backoff é pulado no ciclo normal, e o "tentar agora" (force) ignora os dois', async () => {
    const failed = makeItem({ id: 'f', status: 'failed' })
    const waiting = makeItem({ id: 'w', nextAttemptAt: Date.now() + 600_000 })
    const fetchMock = vi.fn(async () => res(200))
    vi.stubGlobal('fetch', fetchMock)
    listPendingSaves.mockResolvedValue([failed, waiting])
    const { drainPendingSaves } = await import('../offline-sync')
    await drainPendingSaves()
    expect(fetchMock).not.toHaveBeenCalled()
    await drainPendingSaves({ force: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('salvamento grande (acima do limite do corpo): fatia — uma foto por requisição, depois campos + assinatura', async () => {
    const big = (n: string) => ({ blob: new Blob([new Uint8Array(2 * 1024 * 1024)]), name: n, type: 'image/jpeg' })
    const item = makeItem({
      files: { photosBefore: [big('a.jpg'), big('b.jpg')], signature: [{ blob: new Blob(['sig']), name: 'assinatura.png', type: 'image/png' }] },
    })
    listPendingSaves.mockResolvedValueOnce([item]).mockResolvedValueOnce([])
    const forms: FormData[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
      forms.push(init?.body as FormData)
      return res(200)
    }))
    const { drainPendingSaves } = await import('../offline-sync')
    expect(await drainPendingSaves()).toEqual({ synced: 1, failed: 0, remaining: 0 })
    expect(forms).toHaveLength(3)
    expect(forms[0]!.get('status')).toBeNull() // só foto
    expect(forms[0]!.get('clientSaveId')).toBe('item-1-photosBefore-0')
    expect(forms[1]!.get('clientSaveId')).toBe('item-1-photosBefore-1')
    expect(forms[2]!.get('status')).toBe('completed')
    expect(forms[2]!.get('signature')).toBeInstanceOf(File)
    expect(forms[2]!.getAll('photosBefore')).toHaveLength(0)
    expect(deletePendingSave).toHaveBeenCalledWith('item-1')
  })

  it('servidor responde 413 num item pequeno: cai pro modo fatiado em vez de perder', async () => {
    const item = makeItem()
    listPendingSaves.mockResolvedValueOnce([item]).mockResolvedValueOnce([])
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1
      return call === 1 ? res(413) : res(200)
    }))
    const { drainPendingSaves } = await import('../offline-sync')
    expect(await drainPendingSaves()).toEqual({ synced: 1, failed: 0, remaining: 0 })
    expect(call).toBe(3) // direto (413) + foto + final
  })

  it('falha no meio do fatiado: lembra o que já foi enviado e não reenvia tudo', async () => {
    const big = (n: string) => ({ blob: new Blob([new Uint8Array(2 * 1024 * 1024)]), name: n, type: 'image/jpeg' })
    const item = makeItem({ files: { photosBefore: [big('a.jpg'), big('b.jpg')] } })
    listPendingSaves.mockResolvedValueOnce([item]).mockResolvedValueOnce([item])
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1
      return call === 1 ? res(200) : res(503)
    }))
    const { drainPendingSaves } = await import('../offline-sync')
    await drainPendingSaves()
    expect(updatePendingSave).toHaveBeenCalledWith('item-1', { sentFiles: ['photosBefore:0'] })
    expect(deletePendingSave).not.toHaveBeenCalled()
  })

  it('duas sincronizações ao mesmo tempo (dois layouts/abas): só uma roda, sem reenviar o mesmo item', async () => {
    const item = makeItem()
    listPendingSaves.mockResolvedValue([item])
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10))
      return res(200)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { drainPendingSaves } = await import('../offline-sync')
    await Promise.all([drainPendingSaves(), drainPendingSaves(), drainPendingSaves()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('classifyResponse / backoffMs', () => {
  it('classifica os códigos pedidos sem descartar dado', async () => {
    const { classifyResponse, backoffMs } = await import('../offline-sync')
    expect(classifyResponse(200, true)).toEqual({ kind: 'synced' })
    expect(classifyResponse(401, false)).toMatchObject({ kind: 'retry', reason: 'session' })
    expect(classifyResponse(413, false)).toMatchObject({ kind: 'retry', reason: 'too_large' })
    expect(classifyResponse(429, false, '30')).toMatchObject({ kind: 'retry', reason: 'rate_limited', retryAfterMs: 30_000 })
    expect(classifyResponse(500, false)).toMatchObject({ kind: 'retry', reason: 'server' })
    expect(classifyResponse(503, false)).toMatchObject({ kind: 'retry', reason: 'server' })
    expect(classifyResponse(404, false)).toMatchObject({ kind: 'failed' })
    expect(backoffMs(0)).toBe(20_000)
    expect(backoffMs(2)).toBe(80_000)
    expect(backoffMs(20)).toBe(15 * 60_000)
  })
})
