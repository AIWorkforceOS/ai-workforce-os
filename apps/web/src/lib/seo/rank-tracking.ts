// Acompanhamento de posição de palavra-chave (rank tracking) — nenhuma
// API de rank tracking está configurada no projeto hoje (nada como
// SERP_API_KEY/DATAFORSEO). Este módulo assume a SerpApi (serpapi.com,
// engine=google) como provedor de referência por trás de SERP_API_KEY —
// nome proposto pelo mesmo motivo de qualquer outra integração externa
// do projeto (ver CLAUDE.md: "Integrações externas devem falhar de forma
// graciosa quando a env var correspondente não estiver configurada").
//
// Sem a chave configurada, checkKeywordRanking() nunca lança — devolve
// um resultado "not_configured" e quem chama (cron) simplesmente não
// grava linha de histórico para aquela palavra-chave, sem quebrar o
// resto da rotina (auditoria + conteúdo + GBP continuam funcionando).

const FETCH_TIMEOUT_MS = 10_000
const SERP_RESULTS_TO_SCAN = 100

export function getSerpApiKey(): string | null {
  return process.env.SERP_API_KEY || null
}

export type KeywordRankingResult =
  | { status: 'not_configured' }
  | { status: 'ok'; position: number | null }
  | { status: 'error'; message: string }

function hostnameOf(url: string): string | null {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * Consulta a posição de uma palavra-chave nos resultados orgânicos do
 * Google (via SerpApi) para o domínio de `siteUrl`. `position` null
 * significa "não encontrado entre os resultados verificados" (não é erro).
 */
export async function checkKeywordRanking(params: { keyword: string; siteUrl: string }): Promise<KeywordRankingResult> {
  const apiKey = getSerpApiKey()
  if (!apiKey) return { status: 'not_configured' }

  const targetHostname = hostnameOf(params.siteUrl)
  if (!targetHostname) return { status: 'error', message: 'URL do site inválida para checar posição.' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const url = new URL('https://serpapi.com/search.json')
    url.searchParams.set('engine', 'google')
    url.searchParams.set('q', params.keyword)
    url.searchParams.set('num', String(SERP_RESULTS_TO_SCAN))
    url.searchParams.set('api_key', apiKey)

    const response = await fetch(url.toString(), { signal: controller.signal })
    const data = await response.json()

    if (!response.ok) {
      return { status: 'error', message: data?.error ?? `SerpApi retornou status ${response.status}` }
    }

    const organicResults = Array.isArray(data?.organic_results) ? (data.organic_results as { link?: string; position?: number }[]) : []
    const match = organicResults.find((result) => {
      const hostname = result.link ? hostnameOf(result.link) : null
      return hostname === targetHostname
    })

    return { status: 'ok', position: match?.position ?? null }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Falha desconhecida ao consultar a posição.' }
  } finally {
    clearTimeout(timeout)
  }
}
