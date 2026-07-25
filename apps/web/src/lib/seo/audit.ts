// Motor de auditoria técnica de SEO — funcionário digital "SEO"
// (migration 042).
//
// Faz fetch de VERDADE do site cadastrado na entrevista e verifica, sem
// simulação: title tag, meta description, headings (h1/h2), alt text em
// imagens, sitemap.xml, robots.txt, meta viewport, canonical, JSON-LD
// (schema.org) e HTTPS. Cada item vira uma recomendação ESPECÍFICA (não
// genérica) — ver `recommendation` de cada check.
//
// Parsing por regex (sem dependência de HTML parser), mesmo estilo já
// usado em lib/leads/enrichment.ts para o site do lead — este projeto não
// tem cheerio/jsdom, e regex é suficiente para presença/ausência de tags.

import type { SeoCheck, SeoCheckStatus } from './types'

const FETCH_TIMEOUT_MS = 8000
const MAX_HTML_CHARS = 500_000

function check(id: string, label: string, status: SeoCheckStatus, message: string, recommendation: string): SeoCheck {
  return { id, label, status, message, recommendation }
}

/** Acha todas as tags <meta ...> e devolve o valor de `content` da que tiver name/property = `name`. */
function findMetaContent(html: string, name: string): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of metaTags) {
    const nameMatch = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)
    if (!nameMatch || nameMatch[1]!.toLowerCase() !== name.toLowerCase()) continue
    const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)
    if (contentMatch) return contentMatch[1]!.trim()
  }
  return null
}

function findTagText(html: string, tagName: string): string[] {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi')
  const results: string[] = []
  for (const match of html.matchAll(pattern)) {
    const text = (match[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    results.push(text)
  }
  return results
}

function checkTitle(html: string): SeoCheck {
  const titles = findTagText(html, 'title')
  const title = titles[0] ?? ''
  if (!title) {
    return check('title', 'Title tag', 'fail', 'Nenhuma tag <title> encontrada.', 'Adicione uma tag <title> única na página, com 50–60 caracteres, incluindo a principal palavra-chave.')
  }
  if (title.length < 10) {
    return check('title', 'Title tag', 'warning', `Title muito curto (${title.length} caracteres): "${title}".`, 'Amplie o title para 50–60 caracteres, descrevendo o negócio e a palavra-chave principal.')
  }
  if (title.length > 70) {
    return check('title', 'Title tag', 'warning', `Title muito longo (${title.length} caracteres) — pode ser cortado nos resultados de busca: "${title}".`, 'Reduza o title para até ~60 caracteres, mantendo a parte mais importante no início.')
  }
  return check('title', 'Title tag', 'pass', `Title presente e com bom tamanho (${title.length} caracteres): "${title}".`, 'Nenhuma ação necessária.')
}

function checkMetaDescription(html: string): SeoCheck {
  const description = findMetaContent(html, 'description')
  if (!description) {
    return check('meta_description', 'Meta description', 'fail', 'Nenhuma meta description encontrada.', 'Adicione <meta name="description" content="..."> com 120–160 caracteres resumindo a página e incluindo a palavra-chave principal.')
  }
  if (description.length < 50) {
    return check('meta_description', 'Meta description', 'warning', `Meta description muito curta (${description.length} caracteres).`, 'Amplie a meta description para 120–160 caracteres, com uma chamada clara para o clique.')
  }
  if (description.length > 170) {
    return check('meta_description', 'Meta description', 'warning', `Meta description muito longa (${description.length} caracteres) — pode ser cortada.`, 'Reduza a meta description para até ~160 caracteres.')
  }
  return check('meta_description', 'Meta description', 'pass', `Meta description presente e com bom tamanho (${description.length} caracteres).`, 'Nenhuma ação necessária.')
}

function checkHeadings(html: string): SeoCheck[] {
  const h1s = findTagText(html, 'h1')
  const h2s = findTagText(html, 'h2')

  const h1Check =
    h1s.length === 0
      ? check('h1', 'Heading H1', 'fail', 'Nenhum H1 encontrado na página.', 'Adicione exatamente um H1 descrevendo o assunto principal da página, com a palavra-chave alvo.')
      : h1s.length > 1
        ? check('h1', 'Heading H1', 'warning', `${h1s.length} tags H1 encontradas — o ideal é uma só por página.`, 'Deixe apenas um H1 por página; use H2/H3 para os demais títulos de seção.')
        : check('h1', 'Heading H1', 'pass', `Um único H1 encontrado: "${h1s[0]}".`, 'Nenhuma ação necessária.')

  const h2Check =
    h2s.length === 0
      ? check('h2', 'Headings H2', 'warning', 'Nenhum H2 encontrado — a página não tem subtítulos estruturando o conteúdo.', 'Adicione subtítulos H2 dividindo o conteúdo em seções, cada um cobrindo um subtema relacionado à palavra-chave principal.')
      : check('h2', 'Headings H2', 'pass', `${h2s.length} subtítulo(s) H2 encontrado(s).`, 'Nenhuma ação necessária.')

  return [h1Check, h2Check]
}

function checkImageAlt(html: string): SeoCheck {
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? []
  if (imgTags.length === 0) {
    return check('image_alt', 'Texto alternativo (alt) em imagens', 'pass', 'Nenhuma imagem <img> encontrada na página.', 'Nenhuma ação necessária.')
  }
  const missing = imgTags.filter((tag) => {
    const altMatch = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)
    return !altMatch || altMatch[1]!.trim().length === 0
  })
  if (missing.length === 0) {
    return check('image_alt', 'Texto alternativo (alt) em imagens', 'pass', `Todas as ${imgTags.length} imagens têm texto alternativo (alt).`, 'Nenhuma ação necessária.')
  }
  return check(
    'image_alt',
    'Texto alternativo (alt) em imagens',
    'fail',
    `${missing.length} de ${imgTags.length} imagens sem texto alternativo (alt).`,
    'Adicione um atributo alt descritivo em cada imagem (o que ela mostra), ajuda tanto acessibilidade quanto SEO de imagens.',
  )
}

function checkViewport(html: string): SeoCheck {
  const viewport = findMetaContent(html, 'viewport')
  if (!viewport) {
    return check('viewport', 'Meta viewport (mobile-friendly)', 'fail', 'Nenhuma meta viewport encontrada.', 'Adicione <meta name="viewport" content="width=device-width, initial-scale=1"> para o site se adaptar corretamente a celulares.')
  }
  if (!viewport.includes('width=device-width')) {
    return check('viewport', 'Meta viewport (mobile-friendly)', 'warning', `Meta viewport presente mas incomum: "${viewport}".`, 'Use content="width=device-width, initial-scale=1" para garantir compatibilidade total com celulares.')
  }
  return check('viewport', 'Meta viewport (mobile-friendly)', 'pass', 'Meta viewport configurada corretamente.', 'Nenhuma ação necessária.')
}

function checkCanonical(html: string): SeoCheck {
  const match = html.match(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i)
  if (!match) {
    return check('canonical', 'Tag canonical', 'warning', 'Nenhuma tag canonical encontrada.', 'Adicione <link rel="canonical" href="..."> apontando para a URL preferida desta página, evita problemas de conteúdo duplicado.')
  }
  return check('canonical', 'Tag canonical', 'pass', 'Tag canonical presente.', 'Nenhuma ação necessária.')
}

function checkStructuredData(html: string): SeoCheck {
  const hasJsonLd = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["']/i.test(html)
  if (!hasJsonLd) {
    return check('structured_data', 'Dados estruturados (schema.org/JSON-LD)', 'warning', 'Nenhum bloco JSON-LD encontrado.', 'Adicione dados estruturados (schema.org, ex.: LocalBusiness) em JSON-LD — ajuda o Google a exibir informações ricas (endereço, avaliação, horário) nos resultados.')
  }
  return check('structured_data', 'Dados estruturados (schema.org/JSON-LD)', 'pass', 'Bloco JSON-LD encontrado na página.', 'Nenhuma ação necessária.')
}

function checkHttps(pageUrl: string): SeoCheck {
  const isHttps = pageUrl.trim().toLowerCase().startsWith('https://')
  if (!isHttps) {
    return check('https', 'HTTPS', 'fail', 'O site não usa HTTPS.', 'Instale um certificado SSL e migre o site para HTTPS — é fator de ranqueamento e de confiança do visitante.')
  }
  return check('https', 'HTTPS', 'pass', 'Site servido via HTTPS.', 'Nenhuma ação necessária.')
}

/** Checks baseados só no HTML da página + na URL (sem rede) — função pura, testável com fixtures. */
export function analyzeHtml(html: string, pageUrl: string): SeoCheck[] {
  return [checkTitle(html), checkMetaDescription(html), ...checkHeadings(html), checkImageAlt(html), checkViewport(html), checkCanonical(html), checkStructuredData(html), checkHttps(pageUrl)]
}

/** Score 0-100: pass conta 100%, warning 50%, fail 0% — média simples entre os checks. */
export function computeSeoScore(checks: SeoCheck[]): number {
  if (checks.length === 0) return 0
  const weight: Record<SeoCheckStatus, number> = { pass: 1, warning: 0.5, fail: 0 }
  const total = checks.reduce((sum, item) => sum + weight[item.status], 0)
  return Math.round((total / checks.length) * 100)
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow' })
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

async function checkResourceExists(url: string, id: string, label: string): Promise<SeoCheck> {
  const response = await fetchWithTimeout(url)
  if (response?.ok) {
    return check(id, label, 'pass', `${label} encontrado em ${url}.`, 'Nenhuma ação necessária.')
  }
  return check(
    id,
    label,
    'warning',
    `${label} não encontrado em ${url}.`,
    id === 'sitemap'
      ? 'Gere um sitemap.xml listando as páginas do site e o publique nesse caminho — ajuda o Google a indexar mais rápido.'
      : 'Adicione um robots.txt na raiz do site orientando os buscadores sobre o que pode ser indexado.',
  )
}

export type SeoAuditResult = {
  score: number
  checks: SeoCheck[]
  errorMessage: string | null
}

/**
 * Roda a auditoria completa: busca a página real, roda os checks de
 * conteúdo/HTML, e checa sitemap.xml/robots.txt na raiz do site. Nunca
 * lança — site fora do ar vira um único check 'fail' + errorMessage,
 * nunca derruba o cron/rota que chamou.
 */
export async function runSeoAudit(params: { siteUrl: string }): Promise<SeoAuditResult> {
  const siteUrl = params.siteUrl.trim()
  const response = await fetchWithTimeout(siteUrl)

  if (!response || !response.ok) {
    const errorMessage = response
      ? `O site respondeu com status ${response.status} ao tentar acessar ${siteUrl}.`
      : `Não foi possível acessar ${siteUrl} (site fora do ar, URL incorreta ou bloqueio de acesso).`
    const checks = [check('site_unreachable', 'Acesso ao site', 'fail', errorMessage, 'Confirme se a URL está correta e se o site está no ar; tente rodar a auditoria novamente depois.')]
    return { score: computeSeoScore(checks), checks, errorMessage }
  }

  const html = (await response.text()).slice(0, MAX_HTML_CHARS)
  const contentChecks = analyzeHtml(html, siteUrl)

  const origin = originOf(siteUrl)
  const extraChecks: SeoCheck[] = []
  if (origin) {
    const [sitemapCheck, robotsCheck] = await Promise.all([
      checkResourceExists(`${origin}/sitemap.xml`, 'sitemap', 'Sitemap.xml'),
      checkResourceExists(`${origin}/robots.txt`, 'robots', 'Robots.txt'),
    ])
    extraChecks.push(sitemapCheck, robotsCheck)
  }

  const checks = [...contentChecks, ...extraChecks]
  return { score: computeSeoScore(checks), checks, errorMessage: null }
}
