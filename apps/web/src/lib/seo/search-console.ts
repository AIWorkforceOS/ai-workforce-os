// Consulta de desempenho real de busca via Search Console Search Analytics
// API (pedido do Vinicius, 2026-08-23) — dado OFICIAL do Google (cliques,
// impressões, CTR, posição média), não estimativa/scraping.
//
// A API tem atraso de ~2-3 dias nos dados mais recentes (o Google ainda
// está processando), por isso a janela consultada termina alguns dias
// atrás, não "hoje" — consultar hoje devolveria uma janela final vazia/
// incompleta e distorceria os totais.

const SEARCH_CONSOLE_API_BASE = 'https://www.googleapis.com/webmasters/v3'
const DATA_LAG_DAYS = 3
const PERFORMANCE_WINDOW_DAYS = 28
const TOP_QUERIES_LIMIT = 20

export type SearchConsoleQueryRow = {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type SearchConsolePerformance = {
  periodStart: string // YYYY-MM-DD
  periodEnd: string
  totalClicks: number
  totalImpressions: number
  avgCtr: number
  avgPosition: number
  topQueries: SearchConsoleQueryRow[]
}

function toDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10)
}

type GscApiRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }
type GscErrorBody = { error?: { message?: string } }

async function querySearchAnalytics(params: {
  siteUrl: string
  accessToken: string
  startDate: string
  endDate: string
  dimensions: string[]
  rowLimit: number
}): Promise<GscApiRow[]> {
  const response = await fetch(`${SEARCH_CONSOLE_API_BASE}/sites/${encodeURIComponent(params.siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${params.accessToken}` },
    body: JSON.stringify({
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: params.dimensions,
      rowLimit: params.rowLimit,
    }),
  })
  const data = (await response.json()) as GscErrorBody & { rows?: GscApiRow[] }
  if (!response.ok) {
    throw new Error(`Consulta ao Search Console falhou: ${data.error?.message ?? `status ${response.status}`}`)
  }
  return data.rows ?? []
}

/**
 * Busca o desempenho real dos últimos 28 dias: totais do site (cliques/
 * impressões/CTR/posição média) + as palavras-chave que mais geraram
 * clique, ordenadas em código (a API não garante ordenação).
 */
export async function fetchSearchConsolePerformance(params: {
  siteUrl: string
  accessToken: string
}): Promise<SearchConsolePerformance> {
  const endDate = new Date()
  endDate.setUTCDate(endDate.getUTCDate() - DATA_LAG_DAYS)
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - PERFORMANCE_WINDOW_DAYS)

  const periodStart = toDateStamp(startDate)
  const periodEnd = toDateStamp(endDate)

  const [totalsRows, queryRows] = await Promise.all([
    querySearchAnalytics({ siteUrl: params.siteUrl, accessToken: params.accessToken, startDate: periodStart, endDate: periodEnd, dimensions: [], rowLimit: 1 }),
    querySearchAnalytics({
      siteUrl: params.siteUrl,
      accessToken: params.accessToken,
      startDate: periodStart,
      endDate: periodEnd,
      dimensions: ['query'],
      rowLimit: 250, // busca mais que o necessário pra ordenar por clique em código e devolver só o top real
    }),
  ])

  const totals = totalsRows[0]
  const topQueries = queryRows
    .map((row): SearchConsoleQueryRow => ({
      query: row.keys?.[0] ?? '',
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, TOP_QUERIES_LIMIT)

  return {
    periodStart,
    periodEnd,
    totalClicks: totals?.clicks ?? 0,
    totalImpressions: totals?.impressions ?? 0,
    avgCtr: totals?.ctr ?? 0,
    avgPosition: totals?.position ?? 0,
    topQueries,
  }
}
