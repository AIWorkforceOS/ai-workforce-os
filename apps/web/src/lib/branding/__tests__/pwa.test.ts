import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { brandedManifestParts, parseIconKey, renderPwaIcon } from '../pwa'

const navyLogo = () =>
  sharp({ create: { width: 800, height: 298, channels: 4, background: { r: 5, g: 16, b: 36, alpha: 1 } } })
    .composite([{ input: { create: { width: 300, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }, top: 100, left: 250 }])
    .png()
    .toBuffer()

describe('ícone do app instalado', () => {
  it('quadrado do tamanho pedido, com o fundo tirado do canto da logo (azul-marinho da Mawi)', async () => {
    const png = await renderPwaIcon(await navyLogo(), 192, false)
    const meta = await sharp(png).metadata()
    expect([meta.width, meta.height]).toEqual([192, 192])
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    expect([data[0], data[1], data[2]]).toEqual([5, 16, 36]) // canto = fundo da logo
    const mid = (96 * 192 + 96) * info.channels
    expect(data[mid]).toBeGreaterThan(200) // o desenho branco está no centro
  })
  it('logo transparente usa o fundo escuro do sistema; maskable deixa margem maior', async () => {
    const transparent = await sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: { create: { width: 200, height: 80, channels: 4, background: { r: 0, g: 200, b: 100, alpha: 1 } } }, top: 60, left: 100 }]).png().toBuffer()
    const normal = await sharp(await renderPwaIcon(transparent, 512, false)).raw().toBuffer({ resolveWithObject: true })
    expect([normal.data[0], normal.data[1], normal.data[2]]).toEqual([10, 15, 30])
    const countGreen = (r: { data: Buffer; info: { channels: number } }) => { let n = 0; for (let i = 0; i < r.data.length; i += r.info.channels) if (r.data[i + 1]! > 150 && r.data[i]! < 50) n += 1; return n }
    const mask = await sharp(await renderPwaIcon(transparent, 512, true)).raw().toBuffer({ resolveWithObject: true })
    expect(countGreen(mask)).toBeLessThan(countGreen(normal))
  })
  it('só aceita os tamanhos conhecidos', () => {
    expect(parseIconKey('192')).toBe('192')
    expect(parseIconKey('maskable-512')).toBe('maskable-512')
    expect(parseIconKey('9999')).toBeNull()
    expect(parseIconKey('constructor')).toBeNull()
  })
})

describe('manifesto com a marca da empresa', () => {
  it('sem logo própria: Alizo e os ícones de sempre', () => {
    const m = brandedManifestParts({ orgName: 'Mawi Pro', hasLogo: false })
    expect(m.name).toBe('Alizo AI')
    expect(m.icons[0]!.src).toBe('/pwa/icon-192.png')
  })
  it('com logo: nome da empresa e ícones dinâmicos', () => {
    const m = brandedManifestParts({ orgName: 'Mawi Pro', hasLogo: true })
    expect(m).toMatchObject({ name: 'Mawi Pro', shortName: 'Mawi Pro' })
    expect(m.icons.map((i) => i.src)).toEqual(['/api/branding/icon/192', '/api/branding/icon/512', '/api/branding/icon/maskable-512'])
    expect(brandedManifestParts({ orgName: 'Smarter Estágios Brasil Ltda', hasLogo: true }).shortName).toBe('Smarter')
  })
})
