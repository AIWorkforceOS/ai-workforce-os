// Quadros (1080×1920) do vídeo vertical. Mesmo desenho do carrossel (satori via next/og, fontes do projeto, logo e cores reais da marca),
// mas pensado para Reels: texto grande, curto, e fora das faixas que a interface do Instagram cobre (topo ~250 px, base ~420 px).

import { ImageResponse } from 'next/og'
import { fetchImageDataUrl, loadFonts, logoSourceFor, readableOn, type SlideBrand } from './carousel-render'
import { FRAME_HEIGHT, FRAME_WIDTH, type FrameSpec } from './video'

const SAFE_TOP = 250
const SAFE_BOTTOM = 430

function headlineSize(text: string): number {
  if (text.length > 48) return 70
  if (text.length > 32) return 82
  return 96
}

function FrameView({ spec, brand, backgroundDataUrl }: { spec: FrameSpec; brand: SlideBrand; backgroundDataUrl: string | null }) {
  const photo = backgroundDataUrl !== null
  const base = spec.kind === 'cta' && !brand.logo?.darkOnTransparent ? brand.secondary : brand.primary
  const text = photo ? '#FFFFFF' : readableOn(base)
  const accent = photo ? brand.secondary : spec.kind === 'cta' && base === brand.secondary ? text : brand.secondary
  const muted = photo ? 'rgba(255,255,255,0.9)' : text === '#FFFFFF' ? 'rgba(255,255,255,0.86)' : 'rgba(11,18,32,0.82)'
  return (
    <div style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT, display: 'flex', position: 'relative', background: base, fontFamily: 'Liberation, sans-serif' }}>
      {photo && (
        <>
          <img src={backgroundDataUrl} width={FRAME_WIDTH} height={FRAME_HEIGHT} style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover' }} alt="" />
          <div style={{ position: 'absolute', top: 0, left: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT, background: 'rgba(5,10,20,0.62)', display: 'flex' }} />
        </>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '100%', height: '100%', padding: `${SAFE_TOP}px 90px ${SAFE_BOTTOM}px 90px` }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {brand.logo ? (
            <img src={logoSourceFor(brand.logo, text === '#FFFFFF')} width={brand.logo.width} height={brand.logo.height} alt="" style={{ alignSelf: 'flex-start' }} />
          ) : (
            <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, color: text }}>{brand.name}</div>
          )}
          <div style={{ display: 'flex', marginTop: 36 }}>
            {Array.from({ length: spec.total }, (_, i) => (
              <div key={i} style={{ display: 'flex', flex: 1, height: 8, marginRight: i === spec.total - 1 ? 0 : 10, borderRadius: 4, background: i < spec.index ? accent : 'rgba(255,255,255,0.28)' }} />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', width: 140, height: 12, background: accent, marginBottom: 44 }} />
          <div style={{ display: 'flex', fontSize: headlineSize(spec.headline), fontWeight: 700, lineHeight: 1.08, color: text }}>{spec.headline}</div>
          {spec.text && <div style={{ display: 'flex', marginTop: 48, fontSize: 48, lineHeight: 1.32, color: muted }}>{spec.text}</div>}
        </div>

        <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, color: muted }}>{spec.kind === 'cta' ? brand.name : ''}</div>
      </div>
    </div>
  )
}

export async function renderFrame(spec: FrameSpec, brand: SlideBrand, backgroundDataUrl: string | null = null): Promise<Buffer> {
  const response = new ImageResponse(<FrameView spec={spec} brand={brand} backgroundDataUrl={backgroundDataUrl} />, {
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    fonts: loadFonts(),
  })
  return Buffer.from(await response.arrayBuffer())
}

/** Desenha todos os quadros em ordem; cada foto de fundo é baixada uma vez. */
export async function renderFrames(specs: FrameSpec[], brand: SlideBrand): Promise<Buffer[]> {
  const cache = new Map<string, string>()
  const out: Buffer[] = []
  for (const spec of specs) {
    let bg: string | null = null
    if (spec.background_url) {
      bg = cache.get(spec.background_url) ?? (await fetchImageDataUrl(spec.background_url, 'a foto de fundo da cena'))
      cache.set(spec.background_url, bg)
    }
    out.push(await renderFrame(spec, brand, bg))
  }
  return out
}
