import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { lightenDarkPixels } from '../logo-light'
import { brandFrom, logoSourceFor, renderSlide, type SlideLogo } from '../carousel-render'
import { buildSlideSpecs } from '../carousel'

// logo 40x20 transparente: metade esquerda azul-marinho (texto), direita verde (símbolo)
async function darkLogo() {
  const w = 40, h = 20
  const raw = Buffer.alloc(w * h * 4, 0)
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = (y * w + x) * 4
    if (y < 4 || y > 15) continue // bordas ficam transparentes
    const navy = x < 20
    raw[i] = navy ? 2 : 11
    raw[i + 1] = navy ? 30 : 153
    raw[i + 2] = navy ? 68 : 63
    raw[i + 3] = 255
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

async function px(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * 4
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]
}

describe('lightenDarkPixels', () => {
  it('clareia o azul-marinho, mantém o verde e preserva a transparência', async () => {
    const out = await lightenDarkPixels(await darkLogo())
    const [r = 0, g = 0, b = 0, a = 0] = await px(out, 5, 10)
    expect(Math.min(r, g, b)).toBeGreaterThan(200) // texto escuro virou claro
    expect(a).toBe(255)
    expect(await px(out, 30, 10)).toEqual([11, 153, 63, 255]) // verde intacto
    expect((await px(out, 5, 1))[3]).toBe(0) // fundo continua transparente
  })
})

describe('logo no slide: nunca placa/faixa branca', () => {
  const logo = (over: Partial<SlideLogo> = {}): SlideLogo => ({ dataUrl: 'data:image/png;base64,AAA', lightDataUrl: 'data:image/png;base64,BBB', width: 100, height: 50, darkOnTransparent: true, ...over })
  it('escolhe a versão clara só quando a logo é escura e o fundo é escuro', () => {
    expect(logoSourceFor(logo(), true)).toContain('BBB')
    expect(logoSourceFor(logo(), false)).toContain('AAA')
    expect(logoSourceFor(logo({ darkOnTransparent: false }), true)).toContain('AAA')
  })

  it('o slide renderizado não tem bloco branco atrás da logo', async () => {
    const dark = await darkLogo()
    const light = await lightenDarkPixels(dark)
    const brand = brandFrom({
      name: 'Mawi', primary: '#021E44', secondary: '#0B993F', lang: 'en',
      logo: { dataUrl: `data:image/png;base64,${dark.toString('base64')}`, lightDataUrl: `data:image/png;base64,${light.toString('base64')}`, width: 160, height: 80, darkOnTransparent: true },
    })
    for (const spec of buildSlideSpecs({ cover: { title: 'Capa', subtitle: '' }, slides: Array.from({ length: 3 }, () => ({ title: 't', body: 'b' })), cta: { title: 'Fale', body: '' }, hashtags: [] })) {
      const png = await renderSlide(spec, brand, null)
      // canto superior esquerdo da área da logo (padding 104,84): com placa branca seria ~(243,244,246); sem placa é o fundo escuro da marca
      const [r = 255, g = 255, b = 255] = await px(png, 106, 86)
      expect(Math.max(r, g, b)).toBeLessThan(80)
    }
  })
})
