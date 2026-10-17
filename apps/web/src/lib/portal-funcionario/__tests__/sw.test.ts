import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Carrega public/sw.js num contexto isolado com um `self`/`caches`/`fetch` falsos e dispara os eventos do SW.

type Handler = (event: unknown) => void
const source = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8')

function makeCache() {
  const store = new Map<string, unknown>()
  return {
    store,
    match: vi.fn(async (req: { url?: string } | string) => store.get(typeof req === 'string' ? req : req.url ?? '')),
    put: vi.fn(async (req: { url?: string } | string, res: unknown) => void store.set(typeof req === 'string' ? req : req.url ?? '', res)),
    add: vi.fn(async (req: { url?: string } | string) => void store.set(typeof req === 'string' ? req : req.url ?? '', { ok: true })),
    keys: vi.fn(async () => Array.from(store.keys()).map((url) => ({ url }))),
    delete: vi.fn(async (req: { url?: string } | string) => store.delete(typeof req === 'string' ? req : req.url ?? '')),
  }
}

function boot(fetchImpl: (req: unknown) => Promise<unknown>) {
  const handlers: Record<string, Handler> = {}
  const cachesByName = new Map<string, ReturnType<typeof makeCache>>()
  const caches = {
    open: async (name: string) => {
      if (!cachesByName.has(name)) cachesByName.set(name, makeCache())
      return cachesByName.get(name)!
    },
    keys: async () => Array.from(cachesByName.keys()),
    delete: vi.fn(async (name: string) => cachesByName.delete(name)),
  }
  const self = {
    location: { origin: 'https://www.alizoai.com' },
    addEventListener: (type: string, fn: Handler) => void (handlers[type] = fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => {}) },
  }
  class FakeRequest {
    url: string
    constructor(url: string) {
      this.url = url
    }
  }
  class FakeResponse {
    status: number
    headers: Record<string, string>
    ok: boolean
    type = 'basic'
    constructor(public body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
      this.status = init.status ?? 200
      this.headers = init.headers ?? {}
      this.ok = this.status >= 200 && this.status < 300
    }
    clone() {
      return this
    }
    static redirect(url: string, status: number) {
      const r = new FakeResponse('', { status, headers: { location: url } })
      r.ok = false
      return r
    }
  }
  runInNewContext(source, { self, caches, fetch: fetchImpl, Request: FakeRequest, Response: FakeResponse, URL, setTimeout, clearTimeout, Promise })
  const fire = async (req: { url: string; method?: string; mode?: string }) => {
    let responded: Promise<unknown> | null = null
    handlers.fetch!({ request: { method: 'GET', mode: 'cors', ...req }, respondWith: (p: Promise<unknown>) => void (responded = Promise.resolve(p)) })
    return responded
  }
  return { handlers, self, caches, cachesByName, fire, FakeResponse }
}

const nav = (path: string) => ({ url: `https://www.alizoai.com${path}`, mode: 'navigate' })

describe('service worker', () => {
  let offline = false
  const net = (body = 'ok') => async () => {
    if (offline) throw new TypeError('Failed to fetch')
    return { ok: true, status: 200, type: 'basic', clone() { return this }, body }
  }
  beforeEach(() => {
    offline = false
  })

  it('nunca intercepta POST/PATCH/DELETE (upload, fila e salvamento passam direto)', async () => {
    const sw = boot(net())
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
      expect(await sw.fire({ url: 'https://www.alizoai.com/api/units/u/appointments/a/service-order', method })).toBeNull()
    }
  })

  it('nunca toca em /api/, em outro domínio nem em páginas fora do portal', async () => {
    const sw = boot(net())
    expect(await sw.fire({ url: 'https://www.alizoai.com/api/portal-funcionario/offline-snapshot' })).toBeNull()
    expect(await sw.fire({ url: 'https://rvzvxotmpdffvmycgdfk.supabase.co/storage/v1/object/public/service-orders/x.jpg' })).toBeNull()
    expect(await sw.fire(nav('/dashboard/units/abc/agenda'))).toBeNull()
    expect(await sw.fire(nav('/login'))).toBeNull()
  })

  it('online: navegação do portal vai para a rede e NADA da página logada é guardado em cache', async () => {
    const sw = boot(net('pagina-logada'))
    const res = (await sw.fire(nav('/portal-funcionario/ordem/abc'))) as unknown as { body: string }
    expect(res.body).toBe('pagina-logada')
    for (const cache of sw.cachesByName.values()) expect(cache.put).not.toHaveBeenCalled()
  })

  it('offline: navegação do portal vira redirecionamento para a casca com o caminho original', async () => {
    offline = true
    const sw = boot(net())
    const res = (await sw.fire(nav('/portal-funcionario/ordem/abc?x=1'))) as unknown as { status: number; headers: { location: string } }
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://www.alizoai.com/offline-app?to=%2Fportal-funcionario%2Fordem%2Fabc%3Fx%3D1')
  })

  it('casca offline: online guarda a mais nova; offline serve a guardada; sem nada, mensagem clara (503)', async () => {
    const online = boot(net('casca-v1'))
    await online.fire(nav('/offline-app?to=%2Fportal-funcionario'))
    const shell = online.cachesByName.get('alizo-shell-v1')!
    expect(shell.put).toHaveBeenCalledWith('/offline-app', expect.objectContaining({ body: 'casca-v1' }))

    offline = true
    const sw = boot(net())
    const cache = await sw.caches.open('alizo-shell-v1')
    await cache.put('/offline-app', { body: 'casca-guardada' })
    expect(((await sw.fire(nav('/offline-app?to=%2Fportal-funcionario'))) as unknown as { body: string }).body).toBe('casca-guardada')

    const empty = boot(net())
    const res = (await empty.fire(nav('/offline-app'))) as unknown as { status: number; body: string }
    expect(res.status).toBe(503)
    expect(res.body).toMatch(/Sem internet/)
  })

  it('código do app (_next/static) é guardado e depois servido sem rede', async () => {
    const sw = boot(net('js'))
    await sw.fire({ url: 'https://www.alizoai.com/_next/static/chunks/app-123.js' })
    offline = true
    const again = (await sw.fire({ url: 'https://www.alizoai.com/_next/static/chunks/app-123.js' })) as unknown as { body: string }
    expect(again.body).toBe('js')
  })

  it('versão nova NÃO assume sozinha; só quando o app manda SKIP_WAITING', async () => {
    const sw = boot(net())
    await (sw.handlers.install as (e: unknown) => void)({ waitUntil: () => {} })
    expect(sw.self.skipWaiting).not.toHaveBeenCalled()
    sw.handlers.message!({ data: { type: 'SKIP_WAITING' } })
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('ao ativar, apaga só caches antigos da Alizo (nunca IndexedDB, nunca caches de terceiros)', async () => {
    const sw = boot(net())
    await sw.caches.open('alizo-static-v0')
    await sw.caches.open('alizo-shell-v1')
    await sw.caches.open('outro-site')
    let done: Promise<unknown> = Promise.resolve()
    sw.handlers.activate!({ waitUntil: (p: Promise<unknown>) => void (done = p) })
    await done
    expect(sw.caches.delete).toHaveBeenCalledWith('alizo-static-v0')
    expect(sw.caches.delete).not.toHaveBeenCalledWith('alizo-shell-v1')
    expect(sw.caches.delete).not.toHaveBeenCalledWith('outro-site')
    expect(sw.self.clients.claim).toHaveBeenCalled()
  })
})
