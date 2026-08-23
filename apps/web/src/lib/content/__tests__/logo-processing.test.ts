import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { extractPaletteFromLogo, removeSolidBackground } from '../logo-processing'

async function solidPng(width: number, height: number, color: { r: number; g: number; b: number; alpha?: number }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: color.alpha !== undefined ? 4 : 3, background: color } })
    .png()
    .toBuffer()
}

async function logoOnWhiteBg(): Promise<Buffer> {
  const base = sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  const square = await solidPng(10, 10, { r: 200, g: 30, b: 30 })
  return base.composite([{ input: square, left: 15, top: 15 }]).png().toBuffer()
}

async function pixelAt(buffer: Buffer, x: number, y: number) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const offset = (y * info.width + x) * 4
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2], a: data[offset + 3] }
}

describe('removeSolidBackground', () => {
  it('torna transparente o fundo branco uniforme, mantendo o desenho central opaco', async () => {
    const logo = await logoOnWhiteBg()
    const result = await removeSolidBackground(logo)

    const corner = await pixelAt(result, 0, 0)
    expect(corner.a).toBeLessThan(10)

    const center = await pixelAt(result, 20, 20)
    expect(center.a).toBeGreaterThan(200)
    expect(center.r).toBeGreaterThan(150) // continua vermelho
  })

  it('imagem que já tem transparência de verdade — não mexe (devolve a mesma referência)', async () => {
    const transparentBg = sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    const square = await solidPng(10, 10, { r: 255, g: 0, b: 0, alpha: 1 })
    const buffer = await transparentBg.composite([{ input: square, left: 5, top: 5 }]).png().toBuffer()

    const result = await removeSolidBackground(buffer)
    expect(result).toBe(buffer)
  })

  it('cantos muito diferentes entre si (não é fundo sólido) — não mexe', async () => {
    const base = sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    const buffer = await base
      .composite([
        { input: await solidPng(10, 10, { r: 255, g: 0, b: 0 }), left: 0, top: 0 },
        { input: await solidPng(10, 10, { r: 0, g: 255, b: 0 }), left: 10, top: 0 },
        { input: await solidPng(10, 10, { r: 0, g: 0, b: 255 }), left: 0, top: 10 },
        { input: await solidPng(10, 10, { r: 255, g: 255, b: 0 }), left: 10, top: 10 },
      ])
      .png()
      .toBuffer()

    const result = await removeSolidBackground(buffer)
    expect(result).toBe(buffer)
  })
})

async function circleBadgeLogo(): Promise<Buffer> {
  // Emblema circular: canvas quadrado com margem transparente real nos cantos
  // (fora do círculo) + disco branco sólido preenchendo o círculo + uma marca
  // vermelha por cima — reproduz o caso real que o algoritmo antigo deixava
  // passar batido (via de sobra o disco branco intacto).
  const size = 60
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="white" />
  </svg>`
  const badge = sharp(Buffer.from(svg)).png()
  const mark = await solidPng(10, 10, { r: 210, g: 20, b: 20 })
  return badge.composite([{ input: mark, left: 25, top: 25 }]).png().toBuffer()
}

describe('removeSolidBackground — emblema circular (margem já transparente + disco por remover)', () => {
  it('remove o disco branco por dentro da margem transparente, mantendo a marca colorida', async () => {
    const logo = await circleBadgeLogo()
    const result = await removeSolidBackground(logo)

    // acha sobre um fundo verde vivo pra provar transparência real
    // (RGB de pixel totalmente transparente não é confiável sozinho)
    const onColor = await sharp(result).flatten({ background: { r: 0, g: 200, b: 0 } }).raw().toBuffer({ resolveWithObject: true })
    const width = onColor.info.width

    function compositedAt(x: number, y: number) {
      const o = (y * width + x) * 3
      return { r: onColor.data[o], g: onColor.data[o + 1], b: onColor.data[o + 2] }
    }

    // ponto do disco branco (fora da marca vermelha, dentro do círculo) — deve mostrar o verde do fundo composto
    const diskPoint = compositedAt(10, 30)
    expect(diskPoint.g).toBeGreaterThan(150)
    expect(diskPoint.r).toBeLessThan(80)

    // a marca vermelha central continua opaca e vermelha
    const markPoint = compositedAt(30, 30)
    expect(markPoint.r).toBeGreaterThan(150)
    expect(markPoint.g).toBeLessThan(80)
  })
})

describe('extractPaletteFromLogo', () => {
  it('extrai a cor do desenho como primária depois do fundo removido (pixels transparentes são ignorados)', async () => {
    const logo = await logoOnWhiteBg()
    const withoutBg = await removeSolidBackground(logo)

    const palette = await extractPaletteFromLogo(withoutBg)

    expect(palette.primary.toLowerCase()).not.toBe('#ffffff')
    // vermelho: canal R bem mais alto que G e B
    const r = parseInt(palette.primary.slice(1, 3), 16)
    const g = parseInt(palette.primary.slice(3, 5), 16)
    const b = parseInt(palette.primary.slice(5, 7), 16)
    expect(r).toBeGreaterThan(g + 50)
    expect(r).toBeGreaterThan(b + 50)
  })

  it('duas cores bem diferentes e de tamanho parecido — extrai as duas, primária e secundária', async () => {
    const buffer = await sharp({ create: { width: 20, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        { input: await solidPng(10, 10, { r: 220, g: 20, b: 20, alpha: 1 }), left: 0, top: 0 },
        { input: await solidPng(10, 10, { r: 20, g: 20, b: 220, alpha: 1 }), left: 10, top: 0 },
      ])
      .png()
      .toBuffer()

    const palette = await extractPaletteFromLogo(buffer)
    expect(palette.secondary).not.toBeNull()
    expect(palette.primary).not.toBe(palette.secondary)
  })

  it('logo totalmente transparente cai no fallback padrão', async () => {
    const buffer = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer()

    const palette = await extractPaletteFromLogo(buffer)
    expect(palette).toEqual({ primary: '#0EA5E9', secondary: null })
  })
})
