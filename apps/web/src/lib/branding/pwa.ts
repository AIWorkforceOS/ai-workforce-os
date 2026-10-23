import sharp from 'sharp'

export const PWA_ICON_SIZES = { '180': { size: 180, maskable: false }, '192': { size: 192, maskable: false }, '512': { size: 512, maskable: false }, 'maskable-512': { size: 512, maskable: true } } as const
export type PwaIconKey = keyof typeof PWA_ICON_SIZES

export function parseIconKey(value: string): PwaIconKey | null {
  return Object.prototype.hasOwnProperty.call(PWA_ICON_SIZES, value) ? (value as PwaIconKey) : null
}

const FALLBACK_BG = { r: 10, g: 15, b: 30 }

/**
 * Ícone quadrado do app instalado a partir da logo da empresa: a logo cabe inteira (sem cortar nem esticar) sobre um fundo sólido tirado do próprio canto da
 * logo (a da Mawi tem fundo azul-marinho, então o ícone fica todo azul-marinho; logo transparente usa o fundo escuro do sistema). O "maskable" deixa
 * uma margem maior (zona segura) porque o Android recorta as bordas.
 */
export async function renderPwaIcon(logo: Buffer, size: number, maskable: boolean): Promise<Buffer> {
  const { data, info } = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const corner = data.subarray(0, 4)
  const bg = corner[3]! >= 200 ? { r: corner[0]!, g: corner[1]!, b: corner[2]! } : FALLBACK_BG
  void info
  const inner = Math.round(size * (maskable ? 0.58 : 0.8))
  const fitted = await sharp(logo).resize({ width: inner, height: inner, fit: 'inside' }).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 3, background: bg } })
    .composite([{ input: fitted, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

export type ManifestBrand = { orgName: string | null; hasLogo: boolean }

const DEFAULT_ICONS = [
  { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' as const },
  { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' as const },
  { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' as const },
]

/** Nome e ícones do app instalado: da empresa quando ela tem logo própria; senão o Alizo, como sempre foi. */
export function brandedManifestParts(brand: ManifestBrand) {
  if (!brand.hasLogo || !brand.orgName?.trim()) return { name: 'Alizo AI', shortName: 'Alizo', icons: DEFAULT_ICONS }
  const name = brand.orgName.trim()
  return {
    name,
    shortName: name.length <= 12 ? name : (name.split(/\s+/)[0] ?? name).slice(0, 12),
    icons: [
      { src: '/api/branding/icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' as const },
      { src: '/api/branding/icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' as const },
      { src: '/api/branding/icon/maskable-512', sizes: '512x512', type: 'image/png', purpose: 'maskable' as const },
    ],
  }
}
