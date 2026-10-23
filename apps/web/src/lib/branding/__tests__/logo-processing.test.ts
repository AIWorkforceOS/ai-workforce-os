import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { logoObjectPath, normalizeLogo } from '../logo-processing'

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 20, g: 120, b: 200, alpha: 1 } } }).png().toBuffer()
const jpeg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 20, b: 20 } } }).jpeg().toBuffer()
const webp = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 200, b: 20, alpha: 0.5 } } }).webp().toBuffer()

describe('logo da empresa: validação e reprocessamento', () => {
  it('aceita PNG, JPEG e WebP e devolve sempre PNG, com hash estável', async () => {
    for (const [buf, type] of [[await png(400, 200), 'image/png'], [await jpeg(400, 200), 'image/jpeg'], [await webp(400, 200), 'image/webp']] as const) {
      const out = await normalizeLogo(buf, type)
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.contentType).toBe('image/png')
        expect(out.data.subarray(0, 4).toString('hex')).toBe('89504e47')
        expect(out.hash).toMatch(/^[0-9a-f]{12}$/)
      }
    }
    const a = await normalizeLogo(await png(300, 100), 'image/png')
    const b = await normalizeLogo(await png(300, 100), 'image/png')
    expect(a.ok && b.ok && a.hash === b.hash).toBe(true)
  })
  it('reduz imagem grande para caber em 800×400 sem ampliar a pequena', async () => {
    const big = await normalizeLogo(await png(2400, 1200), 'image/png')
    expect(big.ok && big.width <= 800 && big.height <= 400).toBe(true)
    const small = await normalizeLogo(await png(120, 60), 'image/png')
    expect(small.ok && small.width === 120 && small.height === 60).toBe(true)
  })
  it('recusa SVG, HTML/script disfarçado de imagem e tipo não permitido', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect((await normalizeLogo(svg, 'image/svg+xml')).ok).toBe(false)
    expect((await normalizeLogo(svg, 'image/png')).ok).toBe(false) // tipo declarado PNG, conteúdo SVG
    expect((await normalizeLogo(Buffer.from('<html><script>x</script></html>'.repeat(10)), 'image/png')).ok).toBe(false)
    expect((await normalizeLogo(await png(100, 100), 'application/pdf')).ok).toBe(false)
    expect((await normalizeLogo(await png(100, 100), 'image/gif')).ok).toBe(false)
  })
  it('recusa vazio, acima de 2 MB, minúsculo e arquivo corrompido', async () => {
    expect((await normalizeLogo(Buffer.alloc(0), 'image/png')).ok).toBe(false)
    expect((await normalizeLogo(Buffer.concat([await png(100, 100), Buffer.alloc(2 * 1024 * 1024)]), 'image/png')).ok).toBe(false)
    expect((await normalizeLogo(await png(10, 10), 'image/png')).ok).toBe(false)
    const valid = await png(200, 200)
    const corrupted = Buffer.concat([valid.subarray(0, 40), Buffer.alloc(200, 7)]) // cabeçalho PNG + lixo
    expect((await normalizeLogo(corrupted, 'image/png')).ok).toBe(false)
  })
  it('o arquivo gravado não carrega os dados originais (reprocessado)', async () => {
    const withExif = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#fff' } }).withMetadata({ exif: { IFD0: { Copyright: 'segredo-do-cliente' } } }).jpeg().toBuffer()
    const out = await normalizeLogo(withExif, 'image/jpeg')
    expect(out.ok && out.data.toString('latin1').includes('segredo-do-cliente')).toBe(false)
  })
  it('caminho do objeto: uma pasta por empresa, com hash no nome', () => {
    expect(logoObjectPath('org-1', 'abc123def456')).toBe('org-1/logo-abc123def456.png')
  })
})

import { isDarkOnTransparent } from '../logo-processing'

describe('logo escura sobre transparente (brilho claro no painel escuro)', () => {
  const png = (bg: { r: number; g: number; b: number; alpha: number }, fg: { r: number; g: number; b: number }) =>
    sharp({ create: { width: 200, height: 100, channels: 4, background: bg } })
      .composite([{ input: { create: { width: 120, height: 40, channels: 4, background: { ...fg, alpha: 1 } } }, top: 30, left: 40 }])
      .png()
      .toBuffer()
  it('texto escuro em fundo transparente → precisa de brilho', async () => {
    expect(await isDarkOnTransparent(await png({ r: 0, g: 0, b: 0, alpha: 0 }, { r: 20, g: 20, b: 30 }))).toBe(true)
  })
  it('texto claro em fundo transparente → não precisa', async () => {
    expect(await isDarkOnTransparent(await png({ r: 0, g: 0, b: 0, alpha: 0 }, { r: 240, g: 240, b: 240 }))).toBe(false)
  })
  it('logo com fundo próprio (como a da Mawi, azul-marinho) → nunca precisa', async () => {
    expect(await isDarkOnTransparent(await png({ r: 5, g: 16, b: 36, alpha: 1 }, { r: 255, g: 255, b: 255 }))).toBe(false)
  })
  it('o upload marca a logo no nome do arquivo e a renderização lê essa marca', async () => {
    const dark = await normalizeLogo(await png({ r: 0, g: 0, b: 0, alpha: 0 }, { r: 20, g: 20, b: 30 }), 'image/png')
    expect(dark).toMatchObject({ ok: true, needsLightEdge: true })
    const { logoObjectPath } = await import('../logo-processing')
    const { logoIsDarkOnTransparent, logoEdgeStyle } = await import('../render')
    const path = logoObjectPath('org', 'abc123', true)
    expect(path).toBe('org/logo-abc123-dk.png')
    expect(logoIsDarkOnTransparent(`https://x/${path}`)).toBe(true)
    expect(logoIsDarkOnTransparent('https://x/org/logo-abc123.png')).toBe(false)
    expect(logoEdgeStyle('https://x/org/logo-abc123.png')).toBeUndefined()
    expect(logoObjectPath('org', 'abc123')).toBe('org/logo-abc123.png')
  })
})
