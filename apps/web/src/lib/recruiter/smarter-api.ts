// Cliente da API de candidatos da Smarter (§12.2 da spec).
//
// FRONTEIRA EXPLÍCITA: a Smarter é tratada como fornecedora externa de
// dados via API autorizada por token de parceiro. Este repositório NUNCA
// acessa banco, código ou tabelas do Sistema Smarter diretamente
// (regra de isolamento do CLAUDE.md). Os candidatos retornados são
// materializados na tabela `candidates` deste banco, com consentimento
// LGPD rastreado vindo da origem.
//
// Envs (graciosamente degradáveis — ausentes → sourcing usa só a base
// própria e registra warning em system_events):
//   SMARTER_CANDIDATES_API_URL    ex.: https://api.smarter.example/api/partners/candidates
//   SMARTER_CANDIDATES_API_TOKEN  token de parceiro

export type SmarterApiConfig = { url: string; token: string }

export function getSmarterApiConfig(): SmarterApiConfig | null {
  const url = process.env.SMARTER_CANDIDATES_API_URL
  const token = process.env.SMARTER_CANDIDATES_API_TOKEN
  if (!url || !token) return null
  return { url: url.replace(/\/+$/, ''), token }
}

/** Shape esperado do contrato de parceria (campos ausentes são tolerados). */
export type SmarterCandidate = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  city?: string | null
  state?: string | null
  course?: string | null
  semester?: number | null
  institution?: string | null
  skills?: string[] | null
  languages?: string[] | null
  experience_summary?: string | null
  disc_profile?: string | null
  resume_url?: string | null
  consent_status?: string | null
  consent_at?: string | null
}

/**
 * Busca candidatos autorizados na API da Smarter. A Smarter só expõe
 * candidatos com consentimento de compartilhamento; ainda assim o
 * consent_status vindo da origem é persistido e re-checado nos
 * guard-rails de contato.
 */
export async function fetchSmarterCandidates(
  config: SmarterApiConfig,
  params: { course?: string | null; city?: string | null; updatedSince?: string | null; limit?: number },
): Promise<SmarterCandidate[]> {
  const query = new URLSearchParams()
  if (params.course) query.set('course', params.course)
  if (params.city) query.set('city', params.city)
  if (params.updatedSince) query.set('updated_since', params.updatedSince)
  query.set('limit', String(params.limit ?? 200))

  const response = await fetch(`${config.url}?${query.toString()}`, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message = data?.error ?? data?.message ?? `API Smarter retornou status ${response.status}`
    throw new Error(Array.isArray(message) ? message.join(', ') : String(message))
  }

  const rows = Array.isArray(data) ? data : (data?.candidates ?? data?.data ?? [])
  return (rows as SmarterCandidate[]).filter((row) => row && row.id && row.name)
}
