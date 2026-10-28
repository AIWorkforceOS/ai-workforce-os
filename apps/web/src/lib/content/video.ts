// Vídeo curto vertical (9:16, 15–30 s) do Gestor de Conteúdo (migration 112). Tudo aqui é puro: validação do roteiro que a IA devolve,
// ajuste de duração, linha do tempo das transições e o filtro do ffmpeg. Desenho dos quadros: video-render.tsx; codificação: video-encode.ts.

// Saída 720×1280 (9:16, aceito pelo Reels): em 1080×1920 o ffmpeg passava de 650 MB e a função da Vercel era encerrada por falta de memória (medido).
// O layout dos quadros continua desenhado em 1080×1920 (mais nítido, e a capa/prévia usam esse tamanho); o encode reduz os quadros antes do ffmpeg.
export const VIDEO_WIDTH = 720
export const VIDEO_HEIGHT = 1280
export const FRAME_WIDTH = 1080
export const FRAME_HEIGHT = 1920
export const VIDEO_FPS = 30
export const MIN_VIDEO_SECONDS = 15
export const MAX_VIDEO_SECONDS = 30
export const MIN_SCENES = 3 // cenas de conteúdo (sem contar o fechamento)
export const MAX_SCENES = 6
export const TRANSITION_SECONDS = 0.5
const SCENE_MIN = 2
const SCENE_MAX = 6
const CTA_MIN = 3
const CTA_MAX = 5
const HEADLINE_MAX = 60
const TEXT_MAX = 140
const SCRIPT_MAX = 900

/** Transições do ffmpeg (xfade) liberadas: todas discretas, nenhuma que prejudique a leitura do texto. */
export const TRANSITIONS = ['fade', 'slideleft', 'wipeleft', 'dissolve', 'slideright', 'fadeblack'] as const
export type Transition = (typeof TRANSITIONS)[number]

export type VideoScene = {
  headline: string
  text: string
  seconds: number
  /** Transição usada ao ENTRAR nesta cena (ignorada na primeira). */
  transition: Transition
  /** Foto real escolhida pelo dono. Sem ela, o fundo é a cor da marca. */
  background_url?: string | null
}

export type VideoContent = {
  /** Roteiro corrido (para o dono ler/gravar ou para uma narração futura). O vídeo sai mudo, só com texto na tela. */
  script: string
  scenes: VideoScene[]
  cta: { headline: string; text: string; seconds: number; background_url?: string | null }
  hashtags: string[]
}

export type StoredVideo = VideoContent & {
  mp4_url: string
  poster_url: string
  duration: number
  lang?: 'pt' | 'en'
  /** Registro de custo/diagnóstico da renderização (CPU do servidor, sem serviço pago). */
  render_ms?: number
  size_bytes?: number
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

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function transitionAt(i: number): Transition {
  return TRANSITIONS[i % TRANSITIONS.length]!
}

/** Duração total do vídeo: a soma dos segundos das cenas + fechamento (as transições se sobrepõem, não somam). */
export function videoDuration(content: Pick<VideoContent, 'scenes' | 'cta'>): number {
  return content.scenes.reduce((sum, s) => sum + s.seconds, 0) + content.cta.seconds
}

/** Reescala os segundos para a soma cair em `target` (padrão 24 s), respeitando o mínimo/máximo de cada cena. */
export function fitDurations<T extends Pick<VideoContent, 'scenes' | 'cta'>>(content: T, target = 24): T {
  let scenes = content.scenes.map((s) => s.seconds)
  let cta = content.cta.seconds
  for (let round = 0; round < 6; round += 1) {
    const total = scenes.reduce((a, b) => a + b, 0) + cta
    if (Math.abs(total - target) < 0.5) break
    const k = target / total
    scenes = scenes.map((s) => clamp(Math.round(s * k * 2) / 2, SCENE_MIN, SCENE_MAX))
    cta = clamp(Math.round(cta * k * 2) / 2, CTA_MIN, CTA_MAX)
  }
  return { ...content, scenes: content.scenes.map((s, i) => ({ ...s, seconds: scenes[i]! })), cta: { ...content.cta, seconds: cta } }
}

/** Valida/normaliza o JSON da IA. Duração fora de 15–30 s é corrigida automaticamente (a IA erra conta). */
export function normalizeVideo(raw: unknown): { ok: true; value: VideoContent } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Vídeo vazio.' }
  const r = raw as Record<string, unknown>
  const scenes = (Array.isArray(r.scenes) ? r.scenes : [])
    .map((s, i) => {
      const o = (s ?? {}) as Record<string, unknown>
      const seconds = Number(o.seconds)
      return {
        headline: clean(o.headline, HEADLINE_MAX),
        text: clean(o.text, TEXT_MAX),
        seconds: clamp(Number.isFinite(seconds) ? seconds : 4, SCENE_MIN, SCENE_MAX),
        transition: transitionAt(i),
      }
    })
    .filter((s) => s.headline || s.text)
    .slice(0, MAX_SCENES)
  if (scenes.length < MIN_SCENES) return { ok: false, error: `O vídeo precisa de pelo menos ${MIN_SCENES} cenas de conteúdo.` }
  const ctaHeadline = clean(r.cta_title, HEADLINE_MAX)
  if (!ctaHeadline) return { ok: false, error: 'O vídeo veio sem chamada para ação.' }
  const ctaSeconds = Number(r.cta_seconds)
  const content: VideoContent = {
    script: clean(r.script, SCRIPT_MAX),
    scenes,
    cta: { headline: ctaHeadline, text: clean(r.cta_body, TEXT_MAX), seconds: clamp(Number.isFinite(ctaSeconds) ? ctaSeconds : 4, CTA_MIN, CTA_MAX) },
    hashtags: cleanHashtags(r.hashtags),
  }
  const total = videoDuration(content)
  return { ok: true, value: total < MIN_VIDEO_SECONDS || total > MAX_VIDEO_SECONDS ? fitDurations(content) : content }
}

/** Edição vinda do navegador: nunca confia no cliente; duração fora de 15–30 s é erro (o dono decide), não correção silenciosa. */
export function normalizeVideoEdit(raw: unknown): { ok: true; value: VideoContent } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Dados inválidos.' }
  const r = raw as { script?: unknown; scenes?: unknown; cta?: Record<string, unknown>; hashtags?: unknown }
  const bg = (v: unknown) => (typeof v === 'string' && /^https:\/\//.test(v) ? v : null)
  const scenes = (Array.isArray(r.scenes) ? r.scenes : [])
    .map((s, i) => {
      const o = (s ?? {}) as Record<string, unknown>
      const seconds = Number(o.seconds)
      const transition = TRANSITIONS.includes(o.transition as Transition) ? (o.transition as Transition) : transitionAt(i)
      return {
        headline: clean(o.headline, HEADLINE_MAX),
        text: clean(o.text, TEXT_MAX),
        seconds: clamp(Number.isFinite(seconds) ? seconds : 4, SCENE_MIN, SCENE_MAX),
        transition,
        background_url: bg(o.background_url),
      }
    })
    .filter((s) => s.headline || s.text)
  if (scenes.length < MIN_SCENES) return { ok: false, error: `Mantenha pelo menos ${MIN_SCENES} cenas de conteúdo.` }
  if (scenes.length > MAX_SCENES) return { ok: false, error: `No máximo ${MAX_SCENES} cenas de conteúdo.` }
  const cta = r.cta ?? {}
  const ctaSeconds = Number(cta.seconds)
  const content: VideoContent = {
    script: clean(r.script, SCRIPT_MAX),
    scenes,
    cta: { headline: clean(cta.headline, HEADLINE_MAX), text: clean(cta.text, TEXT_MAX), seconds: clamp(Number.isFinite(ctaSeconds) ? ctaSeconds : 4, CTA_MIN, CTA_MAX), background_url: bg(cta.background_url) },
    hashtags: cleanHashtags(r.hashtags),
  }
  if (!content.cta.headline) return { ok: false, error: 'O fechamento precisa de uma chamada para ação.' }
  const total = videoDuration(content)
  if (total < MIN_VIDEO_SECONDS || total > MAX_VIDEO_SECONDS) {
    return { ok: false, error: `A duração total é ${total} s; o vídeo precisa ter entre ${MIN_VIDEO_SECONDS} e ${MAX_VIDEO_SECONDS} s.` }
  }
  return { ok: true, value: content }
}

export type FrameSpec = { kind: 'scene' | 'cta'; index: number; total: number; headline: string; text: string; seconds: number; transition: Transition; background_url: string | null }

/** Quadros a desenhar, em ordem: cenas e fechamento. */
export function buildFrameSpecs(content: VideoContent): FrameSpec[] {
  const total = content.scenes.length + 1
  return [
    ...content.scenes.map((s, i) => ({ kind: 'scene' as const, index: i + 1, total, headline: s.headline, text: s.text, seconds: s.seconds, transition: s.transition, background_url: s.background_url ?? null })),
    { kind: 'cta', index: total, total, headline: content.cta.headline, text: content.cta.text, seconds: content.cta.seconds, transition: transitionAt(content.scenes.length), background_url: content.cta.background_url ?? null },
  ]
}

export type ClipPlan = { inputSeconds: number; transitionIn: Transition | null; offsetOut: number | null }

/**
 * Linha do tempo: cada clipe de entrada dura seus segundos + a transição de saída (exceto o último); a transição i→i+1 começa
 * quando a cena i terminou "inteira" (soma acumulada dos segundos). Resultado: duração total = soma dos segundos.
 */
export function planTimeline(specs: Pick<FrameSpec, 'seconds' | 'transition'>[], transitionSeconds = TRANSITION_SECONDS): ClipPlan[] {
  let acc = 0
  return specs.map((s, i) => {
    const last = i === specs.length - 1
    acc += s.seconds
    return { inputSeconds: s.seconds + (last ? 0 : transitionSeconds), transitionIn: i === 0 ? null : s.transition, offsetOut: last ? null : acc }
  })
}

/**
 * Filtro do ffmpeg: movimento lento (zoom) em cada quadro + transições entre eles. As transições usam o `transition` da cena que ENTRA.
 * Retorna o filter_complex e o rótulo final do vídeo.
 */
export function buildFilterGraph(
  specs: Pick<FrameSpec, 'seconds' | 'transition'>[],
  opts: { width: number; height: number; fps?: number; transitionSeconds?: number },
): { filter: string; outLabel: string } {
  const fps = opts.fps ?? VIDEO_FPS
  const t = opts.transitionSeconds ?? TRANSITION_SECONDS
  const plan = planTimeline(specs, t)
  const parts: string[] = []
  plan.forEach((clip, i) => {
    const frames = Math.round(clip.inputSeconds * fps)
    // zoom de 100% a ~108% ao longo do clipe, centralizado
    const step = (0.08 / Math.max(frames, 1)).toFixed(6)
    parts.push(`[${i}:v]zoompan=z='min(1+${step}*on,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${opts.width}x${opts.height}:fps=${fps},setsar=1,format=yuv420p[v${i}]`)
  })
  let current = 'v0'
  for (let i = 1; i < plan.length; i += 1) {
    const prev = plan[i - 1]!
    const label = i === plan.length - 1 ? 'vout' : `x${i}`
    parts.push(`[${current}][v${i}]xfade=transition=${plan[i]!.transitionIn}:duration=${t}:offset=${prev.offsetOut}[${label}]`)
    current = label
  }
  if (plan.length === 1) parts.push(`[v0]null[vout]`)
  return { filter: parts.join(';'), outLabel: 'vout' }
}

/** Trava de publicação de vídeo (Reels/Facebook). DESLIGADA até um teste real numa página de teste confirmar o fluxo. CONTENT_VIDEO_PUBLISH=on liga. */
export function videoPublishingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.CONTENT_VIDEO_PUBLISH ?? '').toLowerCase() === 'on'
}
