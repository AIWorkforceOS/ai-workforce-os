/**
 * Custo REAL da OpenAI via Costs API (/v1/organization/costs).
 *
 * Exige uma Admin API key da organização (env OPENAI_ADMIN_KEY) — a
 * chave normal de inferência (OPENAI_API_KEY) NÃO tem acesso a esse
 * endpoint. Sem a admin key, o painel usa só o custo estimado a partir
 * dos tokens registrados em api_usage_events.
 */

export type OpenAIRealCost = {
  /** USD faturados no período, direto da OpenAI */
  amountUsd: number
  from: string
  to: string
}

type CostsBucket = {
  results?: { amount?: { value?: number } }[]
}

export async function fetchOpenAIRealCost(params: {
  from: Date
  to?: Date
}): Promise<OpenAIRealCost | null> {
  const adminKey = process.env.OPENAI_ADMIN_KEY
  if (!adminKey) return null

  const startTime = Math.floor(params.from.getTime() / 1000)
  const endTime = params.to ? Math.floor(params.to.getTime() / 1000) : undefined

  let total = 0
  let page: string | null = null

  try {
    // Paginação: buckets diários; limite de segurança de 20 páginas
    for (let i = 0; i < 20; i += 1) {
      const url = new URL('https://api.openai.com/v1/organization/costs')
      url.searchParams.set('start_time', String(startTime))
      if (endTime) url.searchParams.set('end_time', String(endTime))
      url.searchParams.set('limit', '31')
      if (page) url.searchParams.set('page', page)

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 6000)
      let response: Response
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${adminKey}` },
          cache: 'no-store',
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (!response.ok) return null

      const data = (await response.json()) as {
        data?: CostsBucket[]
        has_more?: boolean
        next_page?: string | null
      }

      for (const bucket of data.data ?? []) {
        for (const result of bucket.results ?? []) {
          total += Number(result.amount?.value ?? 0)
        }
      }

      if (!data.has_more || !data.next_page) break
      page = data.next_page
    }

    return {
      amountUsd: total,
      from: params.from.toISOString(),
      to: (params.to ?? new Date()).toISOString(),
    }
  } catch {
    return null
  }
}
