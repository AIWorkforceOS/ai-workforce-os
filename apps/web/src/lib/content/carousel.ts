// Carrossel do Gestor de Conteúdo (migration 111). Tudo aqui é puro: validação do que a IA devolve, ordem/edição dos slides,
// legenda final, escolha entre imagem única e carrossel e a trava de publicação. Desenho dos slides: carousel-render.tsx.

import type { ContentInstruction } from './instructions'

export const MIN_CONTENT_SLIDES = 3
export const MAX_CONTENT_SLIDES = 8
const TITLE_MAX = 70
const BODY_MAX = 220

export type CarouselSlideInput = {
  title: string
  body: string
  /** Foto/imagem de fundo escolhida pelo dono (URL do Storage). Sem ela, o fundo é a cor da marca. */
  background_url?: string | null
}

/** O que o dono vê e edita: capa, slides de conteúdo e fechamento com chamada para ação. */
export type CarouselContent = {
  cover: { title: string; subtitle: string; background_url?: string | null }
  slides: CarouselSlideInput[]
  cta: { title: string; body: string; background_url?: string | null }
  hashtags: string[]
}

/** Conteúdo + os slides já desenhados (mesma ordem: capa, conteúdo…, CTA). */
export type StoredCarousel = CarouselContent & { slide_urls: string[]; /** Idioma dos rótulos fixos dos slides; ausente = português. */ lang?: 'pt' | 'en' }

export type SlideSpec = {
  kind: 'cover' | 'content' | 'cta'
  index: number
  total: number
  title: string
  body: string
  background_url: string | null
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function cleanHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const tags = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter(Boolean)
    .map((v) => `#${v}`)
  return [...new Set(tags)].slice(0, 12)
}

/** Valida/normaliza o JSON da IA. Devolve erro legível se faltar capa, CTA ou slides suficientes. */
export function normalizeCarousel(raw: unknown): { ok: true; value: CarouselContent } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Carrossel vazio.' }
  const r = raw as Record<string, unknown>
  const coverTitle = clean(r.cover_title, TITLE_MAX)
  const ctaTitle = clean(r.cta_title, TITLE_MAX)
  if (!coverTitle) return { ok: false, error: 'O carrossel veio sem título de capa.' }
  if (!ctaTitle) return { ok: false, error: 'O carrossel veio sem chamada para ação.' }
  const slides = (Array.isArray(r.slides) ? r.slides : [])
    .map((s) => ({ title: clean((s as Record<string, unknown>)?.title, TITLE_MAX), body: clean((s as Record<string, unknown>)?.body, BODY_MAX) }))
    .filter((s) => s.title || s.body)
    .slice(0, MAX_CONTENT_SLIDES)
  if (slides.length < MIN_CONTENT_SLIDES) return { ok: false, error: `O carrossel precisa de pelo menos ${MIN_CONTENT_SLIDES} slides de conteúdo.` }
  return {
    ok: true,
    value: {
      cover: { title: coverTitle, subtitle: clean(r.cover_subtitle, BODY_MAX) },
      slides,
      cta: { title: ctaTitle, body: clean(r.cta_body, BODY_MAX) },
      hashtags: cleanHashtags(r.hashtags),
    },
  }
}

/** Edição vinda do navegador: mesmas regras de tamanho/quantidade, nunca confia no cliente. */
export function normalizeCarouselEdit(raw: unknown): { ok: true; value: CarouselContent } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Dados inválidos.' }
  const r = raw as { cover?: Record<string, unknown>; slides?: unknown; cta?: Record<string, unknown>; hashtags?: unknown }
  const bg = (v: unknown) => (typeof v === 'string' && /^https:\/\//.test(v) ? v : null)
  const cover = { title: clean(r.cover?.title, TITLE_MAX), subtitle: clean(r.cover?.subtitle, BODY_MAX), background_url: bg(r.cover?.background_url) }
  const cta = { title: clean(r.cta?.title, TITLE_MAX), body: clean(r.cta?.body, BODY_MAX), background_url: bg(r.cta?.background_url) }
  if (!cover.title) return { ok: false, error: 'A capa precisa de um título.' }
  if (!cta.title) return { ok: false, error: 'O fechamento precisa de uma chamada para ação.' }
  const slides = (Array.isArray(r.slides) ? r.slides : [])
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>
      return { title: clean(o.title, TITLE_MAX), body: clean(o.body, BODY_MAX), background_url: bg(o.background_url) }
    })
    .filter((s) => s.title || s.body)
  if (slides.length < MIN_CONTENT_SLIDES) return { ok: false, error: `Mantenha pelo menos ${MIN_CONTENT_SLIDES} slides de conteúdo.` }
  if (slides.length > MAX_CONTENT_SLIDES) return { ok: false, error: `No máximo ${MAX_CONTENT_SLIDES} slides de conteúdo.` }
  return { ok: true, value: { cover, slides, cta, hashtags: cleanHashtags(r.hashtags) } }
}

/** Ordem final dos slides a desenhar/publicar: capa, conteúdo, fechamento. */
export function buildSlideSpecs(content: CarouselContent): SlideSpec[] {
  const total = content.slides.length + 2
  return [
    { kind: 'cover', index: 1, total, title: content.cover.title, body: content.cover.subtitle, background_url: content.cover.background_url ?? null },
    ...content.slides.map((s, i) => ({ kind: 'content' as const, index: i + 2, total, title: s.title, body: s.body, background_url: s.background_url ?? null })),
    { kind: 'cta', index: total, total, title: content.cta.title, body: content.cta.body, background_url: content.cta.background_url ?? null },
  ]
}

/** Move o slide de conteúdo `from` para a posição `to` (índices dos slides de conteúdo, sem capa/CTA). */
export function moveSlide<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

const CAPTION_MAX = 2200 // limite do Instagram

/** Legenda publicada: texto + hashtags no fim (sem repetir as que o texto já tem), respeitando o limite do Instagram. */
export function composeCaption(text: string, hashtags: string[]): string {
  const body = text.trim()
  const extra = hashtags.filter((h) => !body.toLowerCase().includes(h.toLowerCase()))
  const full = extra.length ? `${body}\n\n${extra.join(' ')}` : body
  return full.length <= CAPTION_MAX ? full : `${full.slice(0, CAPTION_MAX - 1).trimEnd()}…`
}

export type PostFormat = 'image' | 'carousel' | 'video'

const CAROUSEL_RE = /carross?el|carousel/i
const IMAGE_RE = /imagem|image|foto|post\s+[úu]nico|single/i
const VIDEO_RE = /v[ií]deo|video|reel/i

/** No máximo isto de vídeos por rodada de planejamento: render é CPU do servidor e a rota tem tempo limitado. */
export const MAX_VIDEOS_PER_RUN = 2

/**
 * Qual formato este post usa? Sem instrução (ou sem pedir nada além de imagem): imagem única, como sempre foi. Com instrução, vale o que ela pede e não proíbe:
 * um só formato pedido → sempre ele; vários → revezam na ordem carrossel, imagem, vídeo (`previous` = formatos já gerados no mesmo lote, o mais recente por último).
 * `allowVideo: false` tira o vídeo da roda (limite por rodada).
 */
export function pickPostFormat(
  instruction: Pick<ContentInstruction, 'interpretation'> | null,
  previous: PostFormat[],
  opts: { allowVideo?: boolean } = {},
): PostFormat {
  if (!instruction) return 'image'
  const { formats, avoid_formats: avoid } = instruction.interpretation
  const wants = (re: RegExp) => formats.some((f) => re.test(f))
  const avoids = (re: RegExp) => avoid.some((f) => re.test(f))
  const requested: PostFormat[] = []
  if (wants(CAROUSEL_RE) && !avoids(CAROUSEL_RE)) requested.push('carousel')
  if (wants(IMAGE_RE) && !avoids(IMAGE_RE)) requested.push('image')
  if (wants(VIDEO_RE) && !avoids(VIDEO_RE) && opts.allowVideo !== false) requested.push('video')
  if (requested.length === 0) return 'image'
  if (requested.length === 1) return requested[0]!
  const last = previous[previous.length - 1]
  const at = last ? requested.indexOf(last) : -1
  return requested[(at + 1) % requested.length]!
}

/**
 * Trava de publicação de carrossel na Meta. Fica DESLIGADA até um teste real numa página de teste confirmar o fluxo
 * (decisão do Vinicius: nenhum teste em perfil real). Ligar = CONTENT_CAROUSEL_PUBLISH=on nas variáveis de ambiente.
 */
export function carouselPublishingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.CONTENT_CAROUSEL_PUBLISH ?? '').toLowerCase() === 'on'
}
