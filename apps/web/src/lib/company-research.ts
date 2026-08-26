import { fetchHtml, stripHtml } from '@/lib/leads/enrichment'
import { generateStructuredReply } from '@/lib/openai'

/**
 * Pesquisa PROFUNDA do site da empresa pra treinar a KAI/Ficha
 * Compartilhada (organizations.business_profile.company_dossier) —
 * diferente de summarizeCompanySite (lib/leads/enrichment.ts), que só
 * resume 1-2 frases pra personalizar uma mensagem de prospecção fria.
 * Aqui o objetivo é extrair o MÁXIMO de fatos concretos (cardápio,
 * serviços, preços, políticas, horário) pra virar conhecimento real dos
 * 6 funcionários digitais — pedido do Vinicius (2026-08-26): "ela precisa
 * ser como um funcionario de fato onde estuda os arquivos da empresa".
 * Best-effort: qualquer falha (site fora do ar, sem OPENAI_API_KEY,
 * conteúdo insuficiente) devolve erro descritivo, nunca lança — quem
 * chama decide como seguir sem travar a entrevista.
 */

const MAX_SITE_TEXT_CHARS = 12000

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withProtocol)
    return url.toString()
  } catch {
    return null
  }
}

export async function researchCompanyWebsite(params: {
  url: string
  apiKey: string
}): Promise<{ ok: true; summary: string; url: string } | { ok: false; error: string }> {
  const url = normalizeUrl(params.url)
  if (!url) return { ok: false, error: 'URL inválida.' }

  const html = await fetchHtml(url)
  if (!html) return { ok: false, error: 'Não consegui acessar esse site agora.' }

  const text = stripHtml(html).slice(0, MAX_SITE_TEXT_CHARS)
  if (text.length < 50) return { ok: false, error: 'O site não trouxe conteúdo suficiente pra estudar.' }

  try {
    const result = await generateStructuredReply<{ dossier?: string | null }>({
      apiKey: params.apiKey,
      systemPrompt: [
        'Você recebe o texto extraído da página inicial do site de uma empresa.',
        'Escreva um dossiê detalhado, em texto corrido, com TUDO que der pra aprender sobre a empresa a partir desse texto — produtos/serviços oferecidos (com nomes e descrições), preços se aparecerem, políticas de atendimento/cancelamento/garantia, horário de funcionamento, diferenciais, tom de voz da marca, e qualquer outro fato concreto. Use SOMENTE o que está no texto — nunca invente nada que não esteja lá.',
        'Se o texto trouxer pouca informação útil (ex.: só um menu de navegação, sem conteúdo real), responda {"dossier": null}.',
        'Responda SOMENTE um JSON válido: {"dossier": string|null}.',
      ].join(' '),
      history: [{ role: 'user', content: text }],
      maxTokens: 1400,
    })
    const dossier = result.dossier?.trim() || null
    if (!dossier) return { ok: false, error: 'O site não trouxe conteúdo suficiente pra estudar.' }
    return { ok: true, summary: dossier, url }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Falha ao estudar o site.' }
  }
}
