import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { ALLOWED_LOGO_TYPES, LOGO_MAX_HEIGHT, LOGO_MAX_WIDTH, LOGO_MIN_SIDE, MAX_LOGO_BYTES } from './constants'

export type NormalizedLogo = { ok: true; data: Buffer; contentType: 'image/png'; width: number; height: number; hash: string } | { ok: false; error: string }

/** O conteúdo precisa ser mesmo PNG/JPEG/WebP (não basta o nome ou o tipo declarado): evita HTML/SVG/script disfarçado de imagem. */
function sniff(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

/**
 * Valida e REPROCESSA a logo: decodifica a imagem de verdade, corrige a rotação, reduz para caber em 800×400 (sem ampliar) e regrava como PNG
 * sem metadados. Nada do arquivo original (EXIF, perfis, dados extras) chega ao bucket público.
 */
export async function normalizeLogo(input: Buffer, declaredType: string): Promise<NormalizedLogo> {
  if (input.length === 0) return { ok: false, error: 'O arquivo está vazio.' }
  if (input.length > MAX_LOGO_BYTES) return { ok: false, error: 'A logo deve ter no máximo 2 MB.' }
  if (!(ALLOWED_LOGO_TYPES as readonly string[]).includes(declaredType)) return { ok: false, error: 'Use uma imagem PNG, JPEG ou WebP (SVG não é aceito).' }
  const real = sniff(input)
  if (!real) return { ok: false, error: 'O arquivo não é uma imagem PNG, JPEG ou WebP válida.' }
  try {
    const base = sharp(input, { failOn: 'error', limitInputPixels: 25_000_000 })
    const meta = await base.metadata()
    if (!meta.width || !meta.height) return { ok: false, error: 'Não foi possível ler a imagem.' }
    if (meta.width < LOGO_MIN_SIDE || meta.height < LOGO_MIN_SIDE) return { ok: false, error: `A imagem é pequena demais (mínimo ${LOGO_MIN_SIDE}px de largura e altura).` }
    const { data, info } = await base
      .rotate()
      .resize({ width: LOGO_MAX_WIDTH, height: LOGO_MAX_HEIGHT, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true })
    return { ok: true, data, contentType: 'image/png', width: info.width, height: info.height, hash: createHash('sha256').update(data).digest('hex').slice(0, 12) }
  } catch {
    return { ok: false, error: 'Não foi possível processar a imagem. Tente outro arquivo.' }
  }
}

export function logoObjectPath(orgId: string, hash: string): string {
  return `${orgId}/logo-${hash}.png`
}
