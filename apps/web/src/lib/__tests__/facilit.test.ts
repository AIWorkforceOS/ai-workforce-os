import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  facilitLogin,
  fetchFacilitOrders,
  mapFacilitOrder,
  filterOrdersForTodayAndTomorrow,
  FacilitAuthError,
  type MappedFacilitOrder,
} from '../facilit'

// Cliente da API interna da Facil-IT (integração Mawi Pro, 2026-09-10):
// login novo a cada sync + filtro hoje/amanhã no fuso da unidade, conforme
// engenharia reversa feita em tech.facilit.fm/mobileapp.

describe('facilitLogin', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('retorna o token quando o login dá certo', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ token: 'tok-123' }), { status: 200 })) as typeof fetch

    const session = await facilitLogin({ clientCode: 'CC1', username: 'user1', password: 'secret' })

    expect(session).toEqual({ token: 'tok-123', clientCode: 'CC1', username: 'user1' })
  })

  it('lança FacilitAuthError quando o status não é ok', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 401 })) as typeof fetch

    await expect(facilitLogin({ clientCode: 'CC1', username: 'user1', password: 'wrong' })).rejects.toBeInstanceOf(FacilitAuthError)
  })

  it('lança FacilitAuthError quando a resposta não tem token', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as typeof fetch

    await expect(facilitLogin({ clientCode: 'CC1', username: 'user1', password: 'secret' })).rejects.toBeInstanceOf(FacilitAuthError)
  })
})

describe('fetchFacilitOrders', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('manda os 3 headers de auth e devolve o array de ordens', async () => {
    const capturedHeaders: Record<string, string> = {}
    global.fetch = vi.fn(async (_url, init) => {
      const h = new Headers(init?.headers)
      h.forEach((value, key) => { capturedHeaders[key] = value })
      return new Response(JSON.stringify([{ orderNumber: '1' }]), { status: 200 })
    }) as typeof fetch

    const orders = await fetchFacilitOrders({ token: 'tok-123', clientCode: 'CC1', username: 'user1' })

    expect(orders).toEqual([{ orderNumber: '1' }])
    expect(capturedHeaders.authtoken).toBe('tok-123')
    expect(capturedHeaders.username).toBe('user1')
    expect(capturedHeaders.clientcode).toBe('CC1')
  })

  it('lança FacilitAuthError em 401/403 (sessão expirada/revogada)', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 401 })) as typeof fetch

    await expect(fetchFacilitOrders({ token: 'tok', clientCode: 'CC1', username: 'u' })).rejects.toBeInstanceOf(FacilitAuthError)
  })

  it('devolve array vazio se o corpo não for um array', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ notAnArray: true }), { status: 200 })) as typeof fetch

    const orders = await fetchFacilitOrders({ token: 'tok', clientCode: 'CC1', username: 'u' })

    expect(orders).toEqual([])
  })
})

describe('mapFacilitOrder', () => {
  it('mapeia os campos principais de uma ordem crua', () => {
    const mapped = mapFacilitOrder({
      orderNumber: '158725-01',
      poNumber: '211996-01',
      company: 'Walgreen Drug Store #03049',
      address1: '4965 W Bell Rd',
      city: 'Glendale',
      state: 'AZ',
      zip: '85308',
      category: 'Electrical',
      orderType: 'Door Bell',
      priority: 'Low',
      status: 'Scheduled',
      visitDate: '2026-09-14T16:00:00.000Z',
      latitude: 33.64,
      longitude: -112.2,
    })

    expect(mapped).toMatchObject({
      facilit_order_number: '158725-01',
      po_number: '211996-01',
      company: 'Walgreen Drug Store #03049',
      city: 'Glendale',
      state: 'AZ',
      category: 'Electrical',
      order_type: 'Door Bell',
      priority: 'Low',
      status: 'Scheduled',
      visit_date: '2026-09-14T16:00:00.000Z',
      latitude: 33.64,
      longitude: -112.2,
    })
  })

  it('retorna null quando não tem orderNumber (não dá pra identificar a ordem)', () => {
    expect(mapFacilitOrder({ company: 'Sem número' })).toBeNull()
  })

  it('data não reconhecida vira null, sem lançar erro', () => {
    const mapped = mapFacilitOrder({ orderNumber: '1', visitDate: 'não é uma data' })
    expect(mapped?.visit_date).toBeNull()
  })
})

describe('filterOrdersForTodayAndTomorrow', () => {
  const TZ = 'America/Phoenix' // sem DST, deixa o teste estável

  function order(visitDate: string | null): MappedFacilitOrder {
    return {
      facilit_order_number: 'x',
      po_number: null,
      client_po: null,
      company: null,
      address1: null,
      address2: null,
      city: null,
      state: null,
      zip: null,
      phone: null,
      category: null,
      order_type: null,
      priority: null,
      status: null,
      requested_at: null,
      visit_date: visitDate,
      latitude: null,
      longitude: null,
      scope: null,
      raw: {},
    }
  }

  it('mantém ordens de hoje e amanhã, descarta o resto', () => {
    const now = new Date('2026-09-10T18:00:00Z') // 11h da manhã em Phoenix
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const orders = [
      order('2026-09-10T20:00:00Z'), // hoje
      order('2026-09-11T20:00:00Z'), // amanhã
      order('2026-09-12T20:00:00Z'), // depois de amanhã — fora
      order('2026-09-09T20:00:00Z'), // ontem — fora
      order(null), // sem data — fora
    ]

    const result = filterOrdersForTodayAndTomorrow(orders, TZ)

    expect(result).toHaveLength(2)
    vi.useRealTimers()
  })
})
