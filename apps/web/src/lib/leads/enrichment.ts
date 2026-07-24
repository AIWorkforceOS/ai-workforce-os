import type { SupabaseClient } from '@supabase/supabase-js'
import { getGoogleMapsApiKey, placeDetails, textSearch } from '@/lib/google-places'
import { generateStructuredReply, getOpenAIApiKey } from '@/lib/openai'
import type { Lead, LeadEnrichmentData } from '@/lib/types'

// Pesquisa da empresa do lead ANTES do primeiro contato (item 1/2 do
// pedido): Google Places para achar o website + telefone, e o próprio
// website (home + página de contato/sobre, se achar o link) para
// entender o que a empresa faz e achar o melhor e-mail de contato. É
// isso que alimenta buildLeadResearchContext em lib/conversation-engine.ts
// para personalizar a primeira mensagem (WhatsApp e e-mail) em vez de um
// template genérico. Cada etapa é melhor esforço: sem GOOGLE_MAPS_API_KEY,
// sem site encontrado, ou qualquer falha de rede — segue sem pesquisa,
// nunca trava o funil de contato (mesmo padrão gracioso do resto do
// produto, ver CLAUDE.md).

const FETCH_TIMEOUT_MS = 8000
const MAX_HTML_CHARS = 300_000
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const CONTACT_LINK_PATTERN = /contat|contact|sobre|about/i
const GENERIC_EMAIL_PREFIXES = [
  'contato',
  'vendas',
  'sac',
  'atendimento',
  'comercial',
  'info',
  'hello',
  'contact',
  'sales',
]

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType && !contentType.includes('text/html')) return null
    const html = await response.text()
    return html.slice(0, MAX_HTML_CHARS)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractEmails(html: string): string[] {
  const mailtoMatches = Array.from(html.matchAll(/href=["']mailto:([^"'?]+)/gi)).map((m) => m[1] ?? '')
  const textMatches = stripHtml(html).match(EMAIL_PATTERN) ?? []
  return Array.from(new Set([...mailtoMatches, ...textMatches].map((e) => e.trim().toLowerCase()).filter(Boolean)))
}

function pickBestEmail(emails: string[], domain: string | null): string | null {
  if (emails.length === 0) return null
  const sameDomain = domain ? emails.filter((e) => e.endsWith(`@${domain}`)) : []
  const pool = sameDomain.length > 0 ? sameDomain : emails
  const generic = pool.find((e) => GENERIC_EMAIL_PREFIXES.some((prefix) => e.startsWith(`${prefix}@`) || e.startsWith(`${prefix}.`)))
  return generic ?? pool[0] ?? null
}

function findContactLikeLink(html: string, baseUrl: string): string | null {
  const hrefs = Array.from(html.matchAll(/href=["']([^"']+)["']/gi)).map((m) => m[1] ?? '')
  const candidate = hrefs.find(
    (href) => CONTACT_LINK_PATTERN.test(href) && !href.startsWith('mailto:') && !href.startsWith('tel:'),
  )
  if (!candidate) return null
  try {
    return new URL(candidate, baseUrl).toString()
  } catch {
    return null
  }
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * Resume em 1-2 frases o que a empresa faz, com base só no texto extraído
 * do site (nunca inventa além disso). Sem OPENAI_API_KEY ou texto vazio,
 * devolve null — a personalização cai só no que Places/e-mail já deram.
 */
async function summarizeCompanySite(companyName: string, siteText: string): Promise<string | null> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey || !siteText) return null

  try {
    const result = await generateStructuredReply<{ summary?: string | null }>({
      apiKey,
      systemPrompt: [
        `Você recebe um texto extraído do website da empresa "${companyName}".`,
        'Resuma em no máximo 2 frases curtas o que essa empresa faz e para quem, usando SOMENTE o que está no texto — nunca invente.',
        'Responda SOMENTE um JSON válido: {"summary": string|null}. Se o texto não for suficiente para entender o negócio, responda {"summary": null}.',
      ].join(' '),
      history: [{ role: 'user', content: siteText.slice(0, 6000) }],
      maxTokens: 200,
    })
    return result.summary?.trim() || null
  } catch {
    return null
  }
}

/**
 * Pesquisa best-effort da empresa do lead: Google Places (reaproveita
 * lib/google-places.ts) para achar o website, e o próprio site (home +
 * página de contato/sobre, se achar o link) para resumo + e-mail de
 * contato. Nunca lança — qualquer falha em qualquer etapa só reduz o
 * quanto foi encontrado. Devolve null quando nada foi encontrado.
 */
export async function researchLeadCompany(
  lead: Pick<Lead, 'company_name' | 'city' | 'state' | 'google_place_id'>,
): Promise<LeadEnrichmentData | null> {
  const apiKey = getGoogleMapsApiKey()
  let website: string | null = null
  let placeId: string | null = lead.google_place_id ?? null

  if (apiKey) {
    try {
      if (!placeId) {
        const query = [lead.company_name, lead.city, lead.state].filter(Boolean).join(', ')
        const results = await textSearch(query, apiKey)
        placeId = results[0]?.place_id ?? null
      }
      if (placeId) {
        const details = await placeDetails(placeId, apiKey)
        website = details.website ?? null
      }
    } catch {
      // Places é best-effort: uma falha aqui não pode travar a pesquisa do site.
    }
  }

  let summary: string | null = null
  let contactEmail: string | null = null

  if (website) {
    try {
      const homeHtml = await fetchHtml(website)
      if (homeHtml) {
        const domain = hostnameOf(website)
        let combinedText = stripHtml(homeHtml)
        let emails = extractEmails(homeHtml)

        const contactUrl = findContactLikeLink(homeHtml, website)
        if (contactUrl) {
          const contactHtml = await fetchHtml(contactUrl)
          if (contactHtml) {
            combinedText += ' ' + stripHtml(contactHtml)
            emails = Array.from(new Set([...emails, ...extractEmails(contactHtml)]))
          }
        }

        contactEmail = pickBestEmail(emails, domain)
        summary = await summarizeCompanySite(lead.company_name, combinedText)
      }
    } catch {
      // Fetch/extração do site também é best-effort.
    }
  }

  if (!website && !summary && !contactEmail && !placeId) return null

  return { website, summary, contact_email: contactEmail, place_id: placeId }
}

/**
 * Garante que o lead tem pesquisa feita ANTES do primeiro contato,
 * persistindo o resultado em leads.enrichment_data/enriched_at (migration
 * 037) para não pesquisar de novo a cada mensagem. Quando a pesquisa acha
 * um e-mail de contato e o lead ainda não tinha e-mail cadastrado (ex.:
 * leads prospectados via Google Maps, que só têm telefone), preenche
 * leads.email — é isso que destrava o canal de e-mail em
 * sendAcrossChannels para este lead. Devolve o lead já com os campos
 * atualizados; nunca lança (persistência é best-effort).
 */
export async function ensureLeadEnrichment(supabase: SupabaseClient, lead: Lead): Promise<Lead> {
  if (lead.enriched_at) return lead

  let enrichment: LeadEnrichmentData | null = null
  try {
    enrichment = await researchLeadCompany(lead)
  } catch {
    enrichment = null
  }

  const update: Record<string, unknown> = {
    enrichment_data: enrichment,
    enriched_at: new Date().toISOString(),
  }
  if (!lead.email && enrichment?.contact_email) {
    update.email = enrichment.contact_email
  }

  try {
    await supabase.from('leads').update(update).eq('id', lead.id)
  } catch {
    // Persistir é best-effort: se falhar, a próxima tentativa de contato pesquisa de novo.
  }

  return { ...lead, ...update } as Lead
}
