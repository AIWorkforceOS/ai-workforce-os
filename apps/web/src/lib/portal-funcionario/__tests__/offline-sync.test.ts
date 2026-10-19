import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// drainPendingSaves — etapa de confiabilidade (2026-10-16, pedido do
// Vinicius): "não podemos correr o risco de perder informações de uma WO
// por falha de internet, sessão expirada ou erro do servidor". Regra de
// ouro testada aqui: a fila só apaga um item quando o servidor confirma
// (2xx). Qualquer erro mantém o dado guardado.

const listPendingSaves = vi.fn()
const deletePendingSave = vi.fn()
const updatePendingSave = vi.fn()

let activeOwner: string | null = null
const setMeta = vi.fn()
vi.mock('../offline-store', () => ({
  listPendingSaves,
  deletePendingSave,
  updatePendingSave,
  getActiveOwner: () => activeOwner,
  setMeta: (...a: unknown[]) => setMeta(...a),
}))

// O upload direto agora é o padrão; a suíte abaixo cobre o fluxo ANTIGO (fallback) com ele desligado
// e, no fim, o fluxo direto com ele ligado.
let directOn = false
// Envio e registro agora são separados: sobe em paralelo (uploadMediaFile) e registra em lote, na ordem (registerMediaBatch).
const uploadMediaFile = vi.fn()
const registerMediaBatch = vi.fn()
const uploadAndRegisterMedia = uploadMediaFile // compatibilidade com os testes antigos abaixo
vi.mock('../media-upload', () => ({
  directMediaUploadEnabled: () => directOn,
  isMediaField: (f: string) => ['photosBefore', 'photosAfter', 'materialPhotos', 'videos'].includes(f),
  uploadMediaFile: (...a: unknown[]) => uploadMediaFile(...a),
  registerMediaBatch: (...a: unknown[]) => registerMediaBatch(...a),
}))

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

/** A fila é lida duas vezes por pista (início e fim); com duas pistas (vídeo e resto) são quatro leituras: as duas primeiras veem o estado inicial, as demais o estado final. */
function queue(first: unknown[], after: unknown[]) {
  listPendingSaves.mockReset()
  listPendingSaves.mockResolvedValueOnce(first).mockResolvedValueOnce(first).mockResolvedValue(after)
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
    directOn = false
    activeOwner = null
    uploadAndRegisterMedia.mockReset()
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
    queue([item], [])
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
    queue([item], [item])
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
    queue([item], [item])
    vi.stubGlobal('fetch', vi.fn(async () => res(429, { 'Retry-After': '90' })))
    const before = Date.now()
    const { drainPendingSaves } = await import('../offline-sync')
    await drainPendingSaves()
    const patch = updatePendingSave.mock.calls[0]![1] as { nextAttemptAt: number }
    expect(patch.nextAttemptAt).toBeGreaterThanOrEqual(before + 90_000)
  })

  it('recusa definitiva (404): marca como failed e MANTÉM guardado — nunca apaga sozinho', async () => {
    const item = makeItem()
    queue([item], [item])
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
    queue([item], [])
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
    queue([item], [])
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
    queue([item], [item])
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
    expect(backoffMs(20)).toBe(2 * 60_000)
  })
})

describe('drainPendingSaves com upload direto ligado (padrão)', () => {
  const blob = (n: string, size = 1) => ({ blob: new Blob([new Uint8Array(size)]), name: n, type: 'image/jpeg' })
  const uploaded = (n: number) => ({ ok: true as const, media: { path: `u/a/antes-${n}.jpg`, kind: 'before' as const } })
  beforeEach(() => {
    vi.resetModules()
    directOn = true
    uploadMediaFile.mockReset()
    registerMediaBatch.mockReset()
    listPendingSaves.mockReset()
    deletePendingSave.mockReset()
    updatePendingSave.mockReset()
    registerMediaBatch.mockResolvedValue({ kind: 'synced' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200)))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('fotos vão direto ao Storage (nunca no multipart), são registradas e só depois o item é apagado', async () => {
    uploadMediaFile.mockResolvedValue(uploaded(0))
    listPendingSaves.mockResolvedValue([makeItem()])
    const { drainPendingSaves } = await import('../offline-sync')
    const result = await drainPendingSaves()
    expect(uploadMediaFile).toHaveBeenCalledTimes(1)
    expect(uploadMediaFile.mock.calls[0]![0]).toMatchObject({ fieldName: 'photosBefore', appointmentId: 'appt-1' })
    expect(registerMediaBatch).toHaveBeenCalledTimes(1)
    const body = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as FormData
    expect(body.getAll('photosBefore')).toHaveLength(0)
    expect(body.get('status')).toBe('completed')
    expect(deletePendingSave).toHaveBeenCalledWith('item-1')
    expect(result.synced).toBe(1)
  })
  it('sessão expirada no upload direto mantém o item (nada é apagado) e não manda os campos', async () => {
    uploadMediaFile.mockResolvedValue({ ok: false, result: { kind: 'retry', reason: 'session', status: 401 } })
    listPendingSaves.mockResolvedValue([makeItem()])
    const { drainPendingSaves } = await import('../offline-sync')
    const result = await drainPendingSaves()
    expect(deletePendingSave).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(registerMediaBatch).not.toHaveBeenCalled()
    expect(result.remaining).toBe(1)
  })
  it('falha de rede no meio: registra só o que subiu em sequência; o resto sobe de novo na próxima tentativa', async () => {
    uploadMediaFile.mockResolvedValueOnce(uploaded(0)).mockResolvedValueOnce({ ok: false, result: { kind: 'retry', reason: 'network' } })
    listPendingSaves.mockResolvedValue([makeItem({ files: { photosBefore: [blob('a.jpg'), blob('b.jpg')] } })])
    const { drainPendingSaves } = await import('../offline-sync')
    await drainPendingSaves()
    expect(registerMediaBatch.mock.calls[0]![2]).toHaveLength(1)
    expect(updatePendingSave).toHaveBeenCalledWith('item-1', expect.objectContaining({ sentFiles: ['photosBefore:0'] }))
    expect(deletePendingSave).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled() // campos + assinatura só depois de TODOS os anexos
  })
  it('envia em paralelo (no máximo 3 por vez) e registra TUDO de uma vez, na ordem original das fotos', async () => {
    let running = 0
    let peak = 0
    uploadMediaFile.mockImplementation(async (p: { position: number }) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 10 - p.position)) // as últimas terminam primeiro: a ordem de registro NÃO pode depender disso
      running--
      return { ok: true, media: { path: `u/a/antes-${p.position}.jpg`, kind: 'before' } }
    })
    const files = Array.from({ length: 8 }, (_, i) => blob(`f${i}.jpg`))
    listPendingSaves.mockResolvedValue([makeItem({ files: { photosBefore: files } })])
    const { drainPendingSaves, UPLOAD_CONCURRENCY } = await import('../offline-sync')
    await drainPendingSaves()
    expect(UPLOAD_CONCURRENCY).toBe(3)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(3)
    expect(registerMediaBatch).toHaveBeenCalledTimes(1)
    expect((registerMediaBatch.mock.calls[0]![2] as { path: string }[]).map((m) => m.path)).toEqual(Array.from({ length: 8 }, (_, i) => `u/a/antes-${i}.jpg`))
    expect(deletePendingSave).toHaveBeenCalledWith('item-1')
  })
  it('depois da 1ª falha não começa novos envios, e registra só o trecho contínuo que subiu', async () => {
    uploadMediaFile.mockImplementation(async (p: { position: number }) => {
      await new Promise((r) => setTimeout(r, 5))
      return p.position === 1 ? { ok: false, result: { kind: 'retry', reason: 'network' } } : { ok: true, media: { path: `u/a/antes-${p.position}.jpg`, kind: 'before' } }
    })
    listPendingSaves.mockResolvedValue([makeItem({ files: { photosBefore: Array.from({ length: 9 }, (_, i) => blob(`f${i}.jpg`)) } })])
    const { drainPendingSaves } = await import('../offline-sync')
    await drainPendingSaves()
    expect(uploadMediaFile.mock.calls.length).toBeLessThan(9)
    expect((registerMediaBatch.mock.calls[0]![2] as { path: string }[]).map((m) => m.path)).toEqual(['u/a/antes-0.jpg'])
    expect(deletePendingSave).not.toHaveBeenCalled()
  })
  it('retomada: o que já foi enviado e registrado NÃO é reenviado', async () => {
    uploadMediaFile.mockImplementation(async (p: { position: number }) => ({ ok: true, media: { path: `u/a/antes-${p.position}.jpg`, kind: 'before' } }))
    listPendingSaves.mockResolvedValue([makeItem({ sentFiles: ['photosBefore:0', 'photosBefore:1'], files: { photosBefore: [blob('a.jpg'), blob('b.jpg'), blob('c.jpg')] } })])
    const { drainPendingSaves } = await import('../offline-sync')
    await drainPendingSaves()
    expect(uploadMediaFile).toHaveBeenCalledTimes(1)
    expect(uploadMediaFile.mock.calls[0]![0]).toMatchObject({ position: 2 })
    expect(deletePendingSave).toHaveBeenCalledWith('item-1')
  })
  it('falha no registro (servidor) mantém o item e NÃO marca como enviado', async () => {
    uploadMediaFile.mockResolvedValue(uploaded(0))
    registerMediaBatch.mockResolvedValue({ kind: 'retry', reason: 'server', status: 422 })
    listPendingSaves.mockResolvedValue([makeItem()])
    const { drainPendingSaves } = await import('../offline-sync')
    await drainPendingSaves()
    expect(deletePendingSave).not.toHaveBeenCalled()
    expect(updatePendingSave).not.toHaveBeenCalledWith('item-1', expect.objectContaining({ sentFiles: expect.anything() }))
  })
  it('reenvio idempotente: a mesma fila drenada duas vezes não cria envios duplicados do mesmo arquivo concluído', async () => {
    uploadMediaFile.mockResolvedValue(uploaded(0))
    const item = makeItem({ sentFiles: ['photosBefore:0'] })
    listPendingSaves.mockResolvedValue([item])
    const { drainPendingSaves } = await import('../offline-sync')
    await drainPendingSaves()
    await drainPendingSaves()
    expect(uploadMediaFile).not.toHaveBeenCalled()
  })
  it('retomada após reconexão: a 2ª tentativa envia só o que faltou, registra e finaliza o Sign Off com assinatura', async () => {
    const files = Array.from({ length: 4 }, (_, i) => blob(`f${i}.jpg`))
    const up = (p: { position: number }) => ({ ok: true as const, media: { path: `u/a/antes-${p.position}.jpg`, kind: 'before' as const } })
    // 1ª tentativa: caiu a rede no 3º arquivo
    uploadMediaFile.mockImplementation(async (p: { position: number }) => (p.position === 2 ? { ok: false, result: { kind: 'retry', reason: 'network' } } : up(p)))
    const item = makeItem({ files: { photosBefore: files, signature: [blob('assinatura.png')] } })
    listPendingSaves.mockResolvedValue([item])
    const { drainPendingSaves } = await import('../offline-sync')
    await drainPendingSaves()
    expect(deletePendingSave).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled() // assinatura + dados só depois de TODOS os anexos
    const savedProgress = updatePendingSave.mock.calls.map((c) => c[1]).find((patch) => patch.sentFiles)
    expect(savedProgress.sentFiles).toEqual(['photosBefore:0', 'photosBefore:1'])
    // volta a internet: retoma do ponto onde parou
    uploadMediaFile.mockReset().mockImplementation(async (p: { position: number }) => up(p))
    listPendingSaves.mockResolvedValue([{ ...item, sentFiles: ['photosBefore:0', 'photosBefore:1'], attempts: 1 }])
    await drainPendingSaves({ ignoreBackoff: true })
    expect(uploadMediaFile.mock.calls.map((c) => (c[0] as { position: number }).position)).toEqual([2, 3])
    const body = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as FormData
    expect(body.get('signedBy')).toBe('Maria')
    expect(body.get('signature')).toBeInstanceOf(File)
    expect(deletePendingSave).toHaveBeenCalledWith('item-1')
  })
  it('o Sign Off (fotos + assinatura) NÃO espera um vídeo grande: pista própria para vídeos', async () => {
    let releaseVideo: () => void = () => undefined
    uploadMediaFile.mockImplementation(async (p: { fieldName: string; position: number }) => {
      if (p.fieldName === 'videos') await new Promise<void>((r) => (releaseVideo = r))
      return { ok: true, media: { path: `u/a/${p.fieldName}-${p.position}`, kind: p.fieldName === 'videos' ? 'video' : 'before' } }
    })
    const videoItem = makeItem({ id: 'vid', fields: {}, files: { videos: [blob('v.mp4', 10)] } })
    const signOff = makeItem({ id: 'sign', files: { photosBefore: [blob('a.jpg')] } })
    listPendingSaves.mockResolvedValue([videoItem, signOff])
    const { drainPendingSaves } = await import('../offline-sync')
    const videoRun = drainPendingSaves({ lane: 'video' })
    await new Promise((r) => setTimeout(r, 5))
    const result = await drainPendingSaves({ lane: 'default', force: true }) // termina SEM esperar o vídeo
    expect(result.synced).toBe(1)
    expect(deletePendingSave).toHaveBeenCalledWith('sign')
    expect(deletePendingSave).not.toHaveBeenCalledWith('vid')
    releaseVideo()
    await videoRun
    expect(deletePendingSave).toHaveBeenCalledWith('vid')
  })
  it('informa o andamento (anexos, finalização) e as medições por etapa, sem dados da ordem', async () => {
    uploadMediaFile.mockResolvedValue(uploaded(0))
    listPendingSaves.mockResolvedValue([makeItem()])
    const { drainPendingSaves, onDrainProgress } = await import('../offline-sync')
    const events: { phase: string; stage?: string }[] = []
    const off = onDrainProgress((e) => events.push(e))
    await drainPendingSaves()
    off()
    expect(events.map((e) => e.phase)).toEqual(expect.arrayContaining(['uploading', 'registering', 'finalizing', 'timing']))
    expect(events.filter((e) => e.phase === 'timing').map((e) => e.stage)).toEqual(['upload', 'register', 'final'])
    expect(JSON.stringify(events)).not.toMatch(/appt-1|unit-1|foto\.jpg|Maria/)
  })
})

describe('rede voltou / sincronização pendurada', () => {
  beforeEach(() => {
    vi.resetModules()
    directOn = false
    listPendingSaves.mockReset()
    deletePendingSave.mockReset()
    updatePendingSave.mockReset()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200)))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('ignoreBackoff envia item em espera, mas continua pulando item failed', async () => {
    listPendingSaves.mockResolvedValue([
      makeItem({ id: 'esperando', nextAttemptAt: Date.now() + 600_000 }),
      makeItem({ id: 'falhou', status: 'failed' }),
    ])
    const { drainPendingSaves } = await import('../offline-sync')
    await drainPendingSaves({ ignoreBackoff: true })
    expect(deletePendingSave).toHaveBeenCalledWith('esperando')
    expect(deletePendingSave).not.toHaveBeenCalledWith('falhou')
  })
  it('sem ignoreBackoff, item em espera continua esperando', async () => {
    listPendingSaves.mockResolvedValue([makeItem({ nextAttemptAt: Date.now() + 600_000 })])
    const { drainPendingSaves } = await import('../offline-sync')
    await drainPendingSaves()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('sincronização pendurada por mais de 5 min é abandonada e uma nova começa', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    let call = 0
    listPendingSaves.mockImplementation(() => (call++ === 0 ? new Promise(() => {}) : Promise.resolve([])))
    const { drainPendingSaves } = await import('../offline-sync')
    const first = drainPendingSaves()
    vi.setSystemTime(Date.now() + 6 * 60_000)
    const second = await drainPendingSaves()
    expect(second.remaining).toBe(0)
    // a execução abandonada não pode virar rejeição (AbortError do Web Lock tomado): quem a esperava recebe o resultado da nova
    await expect(first).resolves.toMatchObject({ remaining: 0 })
  })
})

describe('marcos de viagem/check-in na fila', () => {
  beforeEach(() => {
    vi.resetModules()
    directOn = false
    listPendingSaves.mockReset()
    deletePendingSave.mockReset()
    updatePendingSave.mockReset()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200)))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('item __event vai para a rota de eventos (JSON com posição), não para o salvamento da ordem', async () => {
    listPendingSaves.mockResolvedValue([
      makeItem({ id: 'ev1', fields: { __event: 'check_in', at: '2026-10-17T10:30:00.000Z', lat: '25.77', lng: '-80.19', accuracy: '12' }, files: {} }),
    ])
    const { drainPendingSaves } = await import('../offline-sync')
    await drainPendingSaves()
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(url).toBe('/api/units/unit-1/appointments/appt-1/events')
    expect(JSON.parse(init.body)).toEqual({ type: 'check_in', at: '2026-10-17T10:30:00.000Z', lat: 25.77, lng: -80.19, accuracy: 12 })
    expect(deletePendingSave).toHaveBeenCalledWith('ev1')
  })
  it('marco sem sinal fica na fila (não se perde)', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'))
    listPendingSaves.mockResolvedValue([makeItem({ id: 'ev2', fields: { __event: 'trip_start', at: '2026-10-17T10:00:00.000Z' }, files: {} })])
    const { drainPendingSaves } = await import('../offline-sync')
    const result = await drainPendingSaves()
    expect(deletePendingSave).not.toHaveBeenCalled()
    expect(result.remaining).toBe(1)
  })
  it('409 (check-in ainda não chegou ao servidor) é nova tentativa, não falha definitiva', async () => {
    const { classifyResponse } = await import('../offline-sync')
    expect(classifyResponse(409, false)).toMatchObject({ kind: 'retry' })
  })
})

describe('troca de usuário no mesmo aparelho', () => {
  beforeEach(() => {
    vi.resetModules()
    directOn = false
    listPendingSaves.mockReset()
    deletePendingSave.mockReset()
    updatePendingSave.mockReset()
    setMeta.mockReset()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200)))
  })
  afterEach(() => {
    activeOwner = null
    vi.unstubAllGlobals()
  })

  it('item de outro funcionário NÃO é enviado nem apagado; o do usuário atual e o antigo (sem dono) são', async () => {
    activeOwner = 'func-B'
    listPendingSaves.mockResolvedValue([
      { ...makeItem({ id: 'do-A' }), ownerId: 'func-A' },
      { ...makeItem({ id: 'do-B' }), ownerId: 'func-B' },
      makeItem({ id: 'antigo-sem-dono' }),
    ])
    const { drainPendingSaves } = await import('../offline-sync')
    const result = await drainPendingSaves()
    expect(deletePendingSave).not.toHaveBeenCalledWith('do-A')
    expect(deletePendingSave).toHaveBeenCalledWith('do-B')
    expect(deletePendingSave).toHaveBeenCalledWith('antigo-sem-dono')
    expect(result.synced).toBe(2)
  })
  it('registra a hora da última sincronização confirmada', async () => {
    listPendingSaves.mockResolvedValue([makeItem({ id: 'x' })])
    const { drainPendingSaves } = await import('../offline-sync')
    await drainPendingSaves()
    expect(setMeta).toHaveBeenCalledWith('last_sync_at', expect.any(Number))
  })
})
