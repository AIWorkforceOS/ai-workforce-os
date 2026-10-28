// Desenho dos slides do carrossel (1080×1350, proporção 4:5 do feed do Instagram). Usa o satori embutido no Next (next/og): o texto
// é desenhado com fontes que vão junto do projeto (public/fonts), então não depende de fontes instaladas no servidor.
// Identidade: cor primária/secundária e logo reais da marca; fundo opcional com foto escolhida pelo dono. Nada é inventado aqui.

import { ImageResponse } from 'next/og'
import sharp from 'sharp'
import { isDarkOnTransparent } from '@/lib/branding/logo-processing'
import { lightenDarkPixels } from './logo-light'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SlideSpec } from './carousel'

export const SLIDE_WIDTH = 1080
export const SLIDE_HEIGHT = 1350

export type SlideLogo = {
  dataUrl: string
  width: number
  height: number
  /** Logo escura sobre transparente: some em fundo escuro. Nunca ganha placa/faixa branca — usa `lightDataUrl` (pixels escuros clareados) sobre fundo escuro. */
  darkOnTransparent: boolean
  lightDataUrl?: string
}

/** A logo que vai no slide: a versão clara (sem placa) quando a logo é escura e o fundo é escuro; senão a original. */
export function logoSourceFor(logo: SlideLogo, backgroundIsDark: boolean): string {
  return logo.darkOnTransparent && backgroundIsDark && logo.lightDataUrl ? logo.lightDataUrl : logo.dataUrl
}

export type SlideBrand = {
  name: string
  primary: string
  secondary: string
  /** Logo já baixada (obrigatória quando a marca tem logo cadastrado — a geração falha antes se não conseguir baixar). */
  logo: SlideLogo | null
  /** Idioma dos rótulos fixos do slide ("Deslize →" / "Swipe →"): o mesmo do texto do post. */
  lang: 'pt' | 'en'
}

const DEFAULT_PRIMARY = '#0A1224'
const DEFAULT_SECONDARY = '#06B6D4'

export function normalizeHex(value: string | null | undefined, fallback: string): string {
  const v = (value ?? '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

/** Razão de contraste WCAG entre duas cores #RRGGBB. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Branco ou quase-preto: o que tiver MAIS contraste com o fundo. */
export function readableOn(background: string): string {
  return contrastRatio(background, '#FFFFFF') >= contrastRatio(background, '#0B1220') ? '#FFFFFF' : '#0B1220'
}

export function brandFrom(params: { name: string; primary?: string | null; secondary?: string | null; logo?: SlideLogo | null; lang?: 'pt' | 'en' }): SlideBrand {
  return {
    name: params.name,
    primary: normalizeHex(params.primary, DEFAULT_PRIMARY),
    secondary: normalizeHex(params.secondary, DEFAULT_SECONDARY),
    logo: params.logo ?? null,
    lang: params.lang ?? 'pt',
  }
}

type Font = { name: string; data: Buffer; weight: 400 | 700; style: 'normal' }
let fontCache: Font[] | null = null

export function loadFonts(): Font[] {
  if (fontCache) return fontCache
  try {
    fontCache = [
      { name: 'Liberation', data: readFileSync(join(process.cwd(), 'public', 'fonts', 'LiberationSans-Regular.ttf')), weight: 400, style: 'normal' },
      { name: 'Liberation', data: readFileSync(join(process.cwd(), 'public', 'fonts', 'LiberationSans-Bold.ttf')), weight: 700, style: 'normal' },
    ]
  } catch {
    // Sem as fontes do projeto, o satori usa a fonte embutida dele (Noto Sans) — o slide sai, só sem negrito.
    fontCache = []
  }
  return fontCache
}

/** Baixa uma imagem (logo/foto de fundo). Erro claro se não baixar, não for PNG/JPG/WebP ou for grande demais. */
async function fetchImage(url: string, what: string): Promise<{ bytes: Buffer; type: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`Não foi possível baixar ${what} (status ${response.status}).`)
  const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim()
  if (!/^image\/(png|jpe?g|webp)$/.test(type)) throw new Error(`${what} não é uma imagem PNG, JPG ou WebP.`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error(`${what} é grande demais (máx. 8 MB).`)
  return { bytes, type }
}

/** Baixa uma imagem como Buffer (com as mesmas validações de tipo e tamanho). */
export async function fetchImageBuffer(url: string, what: string): Promise<Buffer> {
  return (await fetchImage(url, what)).bytes
}

export async function fetchImageDataUrl(url: string, what: string): Promise<string> {
  const { bytes, type } = await fetchImage(url, what)
  return `data:${type};base64,${bytes.toString('base64')}`
}

const LOGO_MAX_HEIGHT = 96
const LOGO_MAX_WIDTH = 360

/** Baixa o logo da marca e mede o tamanho certo para o cabeçalho (o satori precisa de largura e altura explícitas). */
export async function prepareLogo(url: string): Promise<SlideLogo> {
  const { bytes, type } = await fetchImage(url, 'o logo da marca')
  const meta = await sharp(bytes).metadata()
  const w = meta.width ?? 1
  const h = meta.height ?? 1
  const scale = Math.min(LOGO_MAX_HEIGHT / h, LOGO_MAX_WIDTH / w)
  const darkOnTransparent = await isDarkOnTransparent(bytes)
  return {
    dataUrl: `data:${type};base64,${bytes.toString('base64')}`,
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    darkOnTransparent,
    lightDataUrl: darkOnTransparent ? `data:image/png;base64,${(await lightenDarkPixels(bytes)).toString('base64')}` : undefined,
  }
}

function titleSize(kind: SlideSpec['kind'], text: string): number {
  const base = kind === 'cover' ? 92 : 68
  if (text.length > 55) return Math.round(base * 0.72)
  if (text.length > 35) return Math.round(base * 0.85)
  return base
}

function SlideView({ spec, brand, backgroundDataUrl }: { spec: SlideSpec; brand: SlideBrand; backgroundDataUrl: string | null }) {
  const photo = backgroundDataUrl !== null
  // Com foto: véu escuro por cima para o texto branco sempre ler bem. Sem foto: cor da marca.
  // Com logo escura-sobre-transparente, o fechamento também usa o fundo da marca (escuro): a logo clara precisa de fundo escuro para aparecer.
  const base = spec.kind === 'cta' && !brand.logo?.darkOnTransparent ? brand.secondary : brand.primary
  const text = photo ? '#FFFFFF' : readableOn(base)
  const accent = photo ? brand.secondary : spec.kind === 'cta' && base === brand.secondary ? text : brand.secondary
  const muted = photo ? 'rgba(255,255,255,0.88)' : text === '#FFFFFF' ? 'rgba(255,255,255,0.85)' : 'rgba(11,18,32,0.82)'
  return (
    <div style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT, display: 'flex', position: 'relative', background: base, fontFamily: 'Liberation, sans-serif' }}>
      {photo && (
        <>
          <img src={backgroundDataUrl} width={SLIDE_WIDTH} height={SLIDE_HEIGHT} style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover' }} alt="" />
          <div style={{ position: 'absolute', top: 0, left: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT, background: 'rgba(5,10,20,0.62)', display: 'flex' }} />
        </>
      )}
      <div style={{ position: 'absolute', top: 0, left: 0, width: 18, height: SLIDE_HEIGHT, background: accent, display: 'flex' }} />
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '100%', height: '100%', padding: '84px 84px 72px 104px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {brand.logo ? (
            <img src={logoSourceFor(brand.logo, text === '#FFFFFF')} width={brand.logo.width} height={brand.logo.height} alt="" />
          ) : (
            <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, color: text }}>{brand.name}</div>
          )}
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: muted }}>{`${String(spec.index).padStart(2, '0')}/${String(spec.total).padStart(2, '0')}`}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {spec.kind === 'content' && <div style={{ display: 'flex', width: 120, height: 10, background: accent, marginBottom: 36 }} />}
          <div style={{ display: 'flex', fontSize: titleSize(spec.kind, spec.title), fontWeight: 700, lineHeight: 1.1, color: spec.kind === 'cover' && !photo ? text : text }}>{spec.title}</div>
          {spec.body && (
            <div style={{ display: 'flex', marginTop: 44, fontSize: spec.kind === 'cover' ? 42 : 44, lineHeight: 1.35, color: muted }}>{spec.body}</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 30, color: muted }}>
          <div style={{ display: 'flex', fontWeight: 700 }}>{spec.kind === 'cta' ? brand.name : ''}</div>
          <div style={{ display: 'flex', fontWeight: 700, color: photo ? '#FFFFFF' : accent }}>{spec.kind === 'cover' ? (brand.lang === 'en' ? 'Swipe →' : 'Deslize →') : spec.kind === 'content' ? '→' : ''}</div>
        </div>
      </div>
    </div>
  )
}

/** Desenha UM slide e devolve o PNG. `backgroundDataUrl` já vem baixado (ver fetchImageDataUrl). */
export async function renderSlide(spec: SlideSpec, brand: SlideBrand, backgroundDataUrl: string | null = null): Promise<Buffer> {
  const response = new ImageResponse(<SlideView spec={spec} brand={brand} backgroundDataUrl={backgroundDataUrl} />, {
    width: SLIDE_WIDTH,
    height: SLIDE_HEIGHT,
    fonts: loadFonts(),
  })
  return Buffer.from(await response.arrayBuffer())
}

/** Desenha todos os slides, em ordem. Fotos de fundo são baixadas uma vez cada. */
export async function renderSlides(specs: SlideSpec[], brand: SlideBrand): Promise<Buffer[]> {
  const cache = new Map<string, string>()
  const out: Buffer[] = []
  for (const spec of specs) {
    let bg: string | null = null
    if (spec.background_url) {
      bg = cache.get(spec.background_url) ?? (await fetchImageDataUrl(spec.background_url, 'a imagem de fundo do slide'))
      cache.set(spec.background_url, bg)
    }
    out.push(await renderSlide(spec, brand, bg))
  }
  return out
}
