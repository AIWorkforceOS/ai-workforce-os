// Camadas do vídeo vertical, no layout 1080×1920 (o encode reduz para a saída). Cada cena tem duas camadas:
//   • FUNDO: foto em tela cheia (cobre o quadro, sem distorcer) ou a cor da marca quando não há foto;
//   • TEXTO: PNG transparente com degradês de leitura, logo, barra de progresso, título e apoio — é ele que o ffmpeg anima (fade + deslize).
// Texto fora das faixas que a interface do Instagram cobre (topo ~250 px, base ~430 px). Logo clara sobre fundo escuro, nunca placa branca.

import { ImageResponse } from 'next/og'
import sharp from 'sharp'
import { fetchImageBuffer, loadFonts, logoSourceFor, type SlideBrand } from './carousel-render'
import { FRAME_HEIGHT, FRAME_WIDTH, type FrameSpec } from './video'

const SAFE_TOP = 250
const SAFE_BOTTOM = 430
const NAVY = '2,10,24'

function headlineSize(text: string, hook: boolean): number {
  const base = hook ? 112 : 96
  if (text.length > 48) return Math.round(base * 0.72)
  if (text.length > 32) return Math.round(base * 0.85)
  return base
}

function OverlayView({ spec, brand }: { spec: FrameSpec; brand: SlideBrand }) {
  const isCta = spec.kind === 'cta'
  const hook = spec.index === 1
  const accent = brand.secondary
  return (
    <div style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT, display: 'flex', position: 'relative', fontFamily: 'Liberation, sans-serif' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: FRAME_WIDTH, height: 620, display: 'flex', background: `linear-gradient(180deg, rgba(${NAVY},0.7) 0%, rgba(${NAVY},0) 100%)` }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, width: FRAME_WIDTH, height: isCta ? FRAME_HEIGHT : 1250, display: 'flex', background: isCta ? `rgba(${NAVY},0.62)` : `linear-gradient(0deg, rgba(${NAVY},0.94) 0%, rgba(${NAVY},0.7) 50%, rgba(${NAVY},0) 100%)` }} />
      {isCta && <div style={{ position: 'absolute', bottom: 0, left: 0, width: FRAME_WIDTH, height: 900, display: 'flex', background: `linear-gradient(0deg, rgba(${NAVY},0.85) 0%, rgba(${NAVY},0) 100%)` }} />}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: isCta ? 'center' : 'space-between', width: '100%', height: '100%', padding: `${SAFE_TOP}px 90px ${SAFE_BOTTOM}px 90px` }}>
        {!isCta && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {brand.logo ? (
              <img src={logoSourceFor(brand.logo, true)} width={brand.logo.width} height={brand.logo.height} alt="" style={{ alignSelf: 'flex-start' }} />
            ) : (
              <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, color: '#FFFFFF' }}>{brand.name}</div>
            )}
            <div style={{ display: 'flex', marginTop: 36 }}>
              {Array.from({ length: spec.total }, (_, i) => (
                <div key={i} style={{ display: 'flex', flex: 1, height: 8, marginRight: i === spec.total - 1 ? 0 : 10, borderRadius: 4, background: i < spec.index ? accent : 'rgba(255,255,255,0.32)' }} />
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: isCta ? 'center' : 'flex-start' }}>
          {isCta && brand.logo && <img src={logoSourceFor(brand.logo, true)} width={Math.round(brand.logo.width * 1.7)} height={Math.round(brand.logo.height * 1.7)} alt="" style={{ marginBottom: 64 }} />}
          <div style={{ display: 'flex', width: isCta ? 200 : 150, height: 12, background: accent, marginBottom: 44 }} />
          <div style={{ display: 'flex', textAlign: isCta ? 'center' : 'left', fontSize: headlineSize(spec.headline, hook && !isCta) + (isCta ? 8 : 0), fontWeight: 700, lineHeight: 1.06, color: '#FFFFFF' }}>{spec.headline}</div>
          {spec.text && <div style={{ display: 'flex', textAlign: isCta ? 'center' : 'left', marginTop: 44, fontSize: 48, lineHeight: 1.3, color: 'rgba(255,255,255,0.92)' }}>{spec.text}</div>}
          {isCta && <div style={{ display: 'flex', marginTop: 56, fontSize: 38, fontWeight: 700, color: accent }}>{brand.name}</div>}
        </div>
      </div>
    </div>
  )
}

/** Camada de texto (PNG com transparência, 1080×1920). */
export async function renderOverlay(spec: FrameSpec, brand: SlideBrand): Promise<Buffer> {
  const response = new ImageResponse(<OverlayView spec={spec} brand={brand} />, { width: FRAME_WIDTH, height: FRAME_HEIGHT, fonts: loadFonts() })
  return Buffer.from(await response.arrayBuffer())
}

export async function renderOverlays(specs: FrameSpec[], brand: SlideBrand): Promise<Buffer[]> {
  const out: Buffer[] = []
  for (const spec of specs) out.push(await renderOverlay(spec, brand))
  return out
}

export type BackgroundResult = { buffers: Buffer[]; failed: number }

/**
 * Camada de fundo de cada cena (JPEG 1080×1920): a foto cobrindo o quadro; sem foto, ou se o download falhar, a cor da marca. Foto que falha não derruba o vídeo —
 * a cena sai com fundo de cor e o número de falhas volta para quem chamou registrar.
 */
export async function renderBackgrounds(specs: FrameSpec[], brand: SlideBrand): Promise<BackgroundResult> {
  const cache = new Map<string, Buffer | null>()
  const buffers: Buffer[] = []
  let failed = 0
  const solid = () => sharp({ create: { width: FRAME_WIDTH, height: FRAME_HEIGHT, channels: 3, background: brand.primary } }).jpeg({ quality: 90 }).toBuffer()
  for (const spec of specs) {
    if (!spec.background_url) {
      buffers.push(await solid())
      continue
    }
    let photo = cache.get(spec.background_url)
    if (photo === undefined) {
      try {
        photo = await fetchImageBuffer(spec.background_url, 'a imagem de fundo da cena')
      } catch {
        photo = null
      }
      cache.set(spec.background_url, photo)
    }
    if (!photo) {
      failed += 1
      buffers.push(await solid())
      continue
    }
    buffers.push(await sharp(photo).resize(FRAME_WIDTH, FRAME_HEIGHT, { fit: 'cover', position: 'attention' }).jpeg({ quality: 90 }).toBuffer())
  }
  return { buffers, failed }
}

/** Capa do vídeo (e miniatura): fundo + texto da 1ª cena compostos em 1080×1920. */
export async function composePoster(background: Buffer, overlay: Buffer): Promise<Buffer> {
  return sharp(background).composite([{ input: overlay }]).png().toBuffer()
}
