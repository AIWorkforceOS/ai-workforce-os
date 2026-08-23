import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSearchConsolePerformance } from '../search-console'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('fetchSearchConsolePerformance', () => {
  it('busca totais + top palavras-chave dos últimos 28 dias, terminando 3 dias atrás (atraso de dado da API)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'))

    const calls: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as Record<string, unknown>
        calls.push({ url, body })
        if ((body.dimensions as string[]).length === 0) {
          return { ok: true, json: async () => ({ rows: [{ clicks: 120, impressions: 3400, ctr: 0.035, position: 8.2 }] }) }
        }
        return {
          ok: true,
          json: async () => ({
            rows: [
              { keys: ['limpeza comercial phoenix'], clicks: 40, impressions: 900, ctr: 0.044, position: 5.1 },
              { keys: ['limpeza pos obra'], clicks: 80, impressions: 1200, ctr: 0.066, position: 3.4 },
            ],
          }),
        }
      }),
    )

    const result = await fetchSearchConsolePerformance({ siteUrl: 'https://mawi.com/', accessToken: 'access-1' })

    expect(result.periodEnd).toBe('2026-08-20') // hoje (23) menos 3 dias de atraso
    expect(result.periodStart).toBe('2026-07-23') // periodEnd menos 28 dias
    expect(result.totalClicks).toBe(120)
    expect(result.totalImpressions).toBe(3400)
    expect(result.avgCtr).toBe(0.035)
    expect(result.avgPosition).toBe(8.2)
    // ordenado por cliques desc, mesmo a API tendo devolvido em outra ordem
    expect(result.topQueries.map((q) => q.query)).toEqual(['limpeza pos obra', 'limpeza comercial phoenix'])
    expect(result.topQueries[0]).toMatchObject({ clicks: 80, impressions: 1200 })

    expect(calls).toHaveLength(2)
    const [totalsCall, queriesCall] = calls as [{ body: { dimensions: string[]; rowLimit: number } }, { body: { dimensions: string[]; rowLimit: number } }]
    expect(totalsCall.body.dimensions).toEqual([])
    expect(queriesCall.body.dimensions).toEqual(['query'])
  })

  it('zera os totais quando a API não devolve nenhuma linha (site sem dado suficiente ainda)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ rows: [] }) })))
    const result = await fetchSearchConsolePerformance({ siteUrl: 'https://novo-site.com/', accessToken: 'access-1' })
    expect(result.totalClicks).toBe(0)
    expect(result.totalImpressions).toBe(0)
    expect(result.topQueries).toEqual([])
  })

  it('lança erro claro quando a consulta falha (token expirado, propriedade sem acesso etc.)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'sem permissão nessa propriedade' } }) })))
    await expect(fetchSearchConsolePerformance({ siteUrl: 'https://mawi.com/', accessToken: 'access-1' })).rejects.toThrow('sem permissão')
  })

  it('limita o top de palavras-chave a 20 itens mesmo com mais linhas retornadas', async () => {
    const manyRows = Array.from({ length: 60 }, (_, i) => ({ keys: [`termo ${i}`], clicks: 60 - i, impressions: 100, ctr: 0.05, position: 5 }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { dimensions: string[] }
        if (body.dimensions.length === 0) return { ok: true, json: async () => ({ rows: [] }) }
        return { ok: true, json: async () => ({ rows: manyRows }) }
      }),
    )
    const result = await fetchSearchConsolePerformance({ siteUrl: 'https://mawi.com/', accessToken: 'access-1' })
    expect(result.topQueries).toHaveLength(20)
    expect(result.topQueries[0]?.query).toBe('termo 0') // maior número de cliques
  })
})
