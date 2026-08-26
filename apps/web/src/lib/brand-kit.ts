// Identidade visual da marca (logo + paleta), guardada em
// organizations.business_profile.brand_kit (ver api/content/brand-kit).
// Compartilhado entre Conteúdo/Social e Tráfego Pago — os dois geram
// imagem com gpt-image-2 e colam o logo real por cima via sharp, porque
// nenhum gerador de imagem reproduz um logo específico de forma
// consistente só por descrição textual.

import sharp from 'sharp'

export type BrandKit = { logo_url?: string | null; primary_color?: string | null; secondary_color?: string | null }

export function brandKitFrom(organizationProfile: Record<string, unknown> | null | undefined): BrandKit | null {
  const raw = (organizationProfile as { brand_kit?: BrandKit } | null | undefined)?.brand_kit
  if (!raw || (!raw.logo_url && !raw.primary_color && !raw.secondary_color)) return null
  return raw
}

/** Cola o logo da marca no canto inferior direito da imagem gerada (padding + redimensionamento proporcionais ao tamanho da imagem). */
export async function compositeLogoOntoImage(baseImageBase64: string, logoUrl: string): Promise<string> {
  const baseBuffer = Buffer.from(baseImageBase64, 'base64')
  const logoResponse = await fetch(logoUrl, { signal: AbortSignal.timeout(15_000) })
  if (!logoResponse.ok) throw new Error(`Não foi possível baixar o logo da marca (status ${logoResponse.status}).`)
  const logoBuffer = Buffer.from(await logoResponse.arrayBuffer())

  const baseMeta = await sharp(baseBuffer).metadata()
  const baseWidth = baseMeta.width ?? 1024
  const baseHeight = baseMeta.height ?? 1024

  const targetLogoWidth = Math.round(baseWidth * 0.18)
  const resizedLogo = await sharp(logoBuffer)
    .resize({ width: targetLogoWidth, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer()
  const logoMeta = await sharp(resizedLogo).metadata()

  const padding = Math.round(baseWidth * 0.03)
  const left = Math.max(0, baseWidth - (logoMeta.width ?? targetLogoWidth) - padding)
  const top = Math.max(0, baseHeight - (logoMeta.height ?? targetLogoWidth) - padding)

  const composited = await sharp(baseBuffer)
    .composite([{ input: resizedLogo, left, top }])
    .png()
    .toBuffer()
  return composited.toString('base64')
}
