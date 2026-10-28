import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandFrom } from '../carousel-render'
import { composePoster, renderBackgrounds, renderOverlay } from '../video-render'
import { buildFrameSpecs, FRAME_HEIGHT, FRAME_WIDTH, type VideoContent } from '../video'

const content: VideoContent = {
  script: '',
  scenes: [0, 1, 2].map((i) => ({ headline: `Cena ${i}`, text: 'Texto de apoio', seconds: 5, transition: 'fade' as const })),
  cta: { headline: 'Fale com a gente', text: '', seconds: 4 },
  hashtags: [],
}
const brand = brandFrom({ name: 'Mawi', primary: '#021E44', secondary: '#0B993F', lang: 'pt' })
const alphaAt = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return data[(y * info.width + x) * 4 + 3]!
}

afterEach(() => vi.unstubAllGlobals())

describe('camada de texto (overlay)', () => {
  it('é PNG 1080×1920 com transparência: degradê forte nas bordas e o meio da foto livre', async () => {
    const specs = buildFrameSpecs(content)
    const png = await renderOverlay(specs[0]!, brand)
    const meta = await sharp(png).metadata()
    expect([meta.width, meta.height, meta.channels]).toEqual([FRAME_WIDTH, FRAME_HEIGHT, 4])
    expect(await alphaAt(png, 1070, 5)).toBeGreaterThan(120) // topo escurecido
    expect(await alphaAt(png, 1070, 1900)).toBeGreaterThan(200) // base escurecida
    expect(await alphaAt(png, 1070, 645)).toBeLessThan(25) // faixa do meio sem véu: a foto aparece
  })
  it('o fechamento também sai (véu mais forte)', async () => {
    const specs = buildFrameSpecs(content)
    const png = await renderOverlay(specs[specs.length - 1]!, brand)
    expect(await alphaAt(png, 1070, 5)).toBeGreaterThan(100)
  })
})

describe('camada de fundo', () => {
  it('sem foto: a cor da marca em 1080×1920', async () => {
    const { buffers, failed } = await renderBackgrounds(buildFrameSpecs(content), brand)
    expect(failed).toBe(0)
    expect(buffers).toHaveLength(4)
    const { data, info } = await sharp(buffers[0]!).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([FRAME_WIDTH, FRAME_HEIGHT])
    // #021E44 = (2, 30, 68), com tolerância de JPEG
    expect([Math.abs(data[0]! - 2), Math.abs(data[1]! - 30), Math.abs(data[2]! - 68)].every((d) => d < 8)).toBe(true)
  })

  it('foto cobre o quadro sem distorcer; foto que não baixa vira cor da marca e é contada', async () => {
    const photo = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#cc3333' } }).png().toBuffer()
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('ok')
        ? { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => photo.buffer.slice(photo.byteOffset, photo.byteOffset + photo.byteLength) }
        : { ok: false, status: 404, headers: new Headers() },
    ))
    const c = structuredClone(content)
    c.scenes[0]!.background_url = 'https://cdn/ok.png'
    c.scenes[1]!.background_url = 'https://cdn/quebrada.png'
    const { buffers, failed } = await renderBackgrounds(buildFrameSpecs(c), brand)
    expect(failed).toBe(1)
    const [r0 = 0] = await sharp(buffers[0]!).raw().toBuffer()
    const [r1 = 0] = await sharp(buffers[1]!).raw().toBuffer()
    expect(r0).toBeGreaterThan(150) // foto vermelha
    expect(r1).toBeLessThan(40) // fallback: cor da marca
  })
})

describe('capa do vídeo', () => {
  it('fundo + texto da 1ª cena compostos em PNG 1080×1920', async () => {
    const specs = buildFrameSpecs(content)
    const { buffers } = await renderBackgrounds(specs, brand)
    const poster = await composePoster(buffers[0]!, await renderOverlay(specs[0]!, brand))
    const meta = await sharp(poster).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', FRAME_WIDTH, FRAME_HEIGHT])
  })
})
