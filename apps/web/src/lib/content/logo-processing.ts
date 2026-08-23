// Processamento do logo da marca (pedido do Vinicius, 2026-08-23):
// 1) remove o fundo sólido do logo enviado, pra colar limpo em cima dos
//    posts gerados (ver generator.ts, compositeLogoOntoImage);
// 2) extrai a paleta de cores dominante do próprio logo, pra pré-preencher
//    cor primária/secundária automaticamente em vez do usuário escolher
//    na mão toda vez.
//
// Não é segmentação por IA (isso exigiria um modelo/serviço externo pago)
// — é uma heurística de chroma-key: assume que o fundo é uma cor sólida
// (o caso comum de logo em fundo branco/liso) e torna transparente todo
// pixel parecido com a cor dos 4 cantos da imagem. Fundos com gradiente,
// foto, ou fundo já transparente (PNG) não são mexidos — nesse caso, o
// próprio checkAlreadyTransparent() garante que a função é no-op.

import sharp from 'sharp'

type RGB = { r: number; g: number; b: number }

export type ExtractedPalette = { primary: string; secondary: string | null }

function colorDistance(a: RGB, b: RGB): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

function averageColor(colors: RGB[]): RGB {
  const sum = colors.reduce((acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }), { r: 0, g: 0, b: 0 })
  return { r: sum.r / colors.length, g: sum.g / colors.length, b: sum.b / colors.length }
}

function toHex({ r, g, b }: RGB): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function pixelAt(data: Buffer, width: number, x: number, y: number): RGB {
  const offset = (y * width + x) * 4
  return { r: data[offset]!, g: data[offset + 1]!, b: data[offset + 2]! }
}

/** Já tem transparência real de sobra (ex: PNG exportado com fundo removido) — não mexe. */
function hasEnoughExistingTransparency(data: Buffer, pixelCount: number): boolean {
  let transparent = 0
  for (let i = 0; i < pixelCount; i++) {
    if (data[i * 4 + 3]! < 16) transparent += 1
  }
  return transparent / pixelCount > 0.05
}

const BG_THRESHOLD = 32
const BG_SOFT_BAND = 20
const MAX_CORNER_SPREAD = 40

/**
 * Remove o fundo sólido do logo (heurística de chroma-key pelos cantos).
 * Devolve PNG com transparência. Se o fundo não for uniforme o bastante
 * (cantos muito diferentes entre si) ou já tiver transparência real,
 * devolve a imagem original sem mexer — mais seguro que arriscar estragar
 * um logo com fundo complexo.
 */
export async function removeSolidBackground(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  if (channels < 4 || width < 2 || height < 2) return input

  const pixelCount = width * height
  if (hasEnoughExistingTransparency(data, pixelCount)) return input

  const corners = [
    pixelAt(data, width, 0, 0),
    pixelAt(data, width, width - 1, 0),
    pixelAt(data, width, 0, height - 1),
    pixelAt(data, width, width - 1, height - 1),
  ]
  const bgColor = averageColor(corners)
  const cornerSpread = Math.max(...corners.map((c) => colorDistance(c, bgColor)))
  if (cornerSpread > MAX_CORNER_SPREAD) return input // cantos muito diferentes — provavelmente não é fundo sólido

  const out = Buffer.from(data)
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4
    const pixel: RGB = { r: data[offset]!, g: data[offset + 1]!, b: data[offset + 2]! }
    const dist = colorDistance(pixel, bgColor)
    if (dist < BG_THRESHOLD) {
      out[offset + 3] = 0
    } else if (dist < BG_THRESHOLD + BG_SOFT_BAND) {
      // banda de transição suave — evita borda serrilhada dura
      const fade = (dist - BG_THRESHOLD) / BG_SOFT_BAND
      out[offset + 3] = Math.round(out[offset + 3]! * fade)
    }
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

const COLOR_BUCKET_SIZE = 24
const MIN_SECONDARY_DISTANCE = 60

/**
 * Extrai as 1-2 cores mais dominantes de um logo (só considera pixels não
 * transparentes) — usada pra pré-preencher a paleta de marca
 * automaticamente quando o logo é enviado.
 */
export async function extractPaletteFromLogo(input: Buffer): Promise<ExtractedPalette> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const pixelCount = width * height

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>()
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4
    if (data[offset + 3]! < 128) continue // pixel transparente — ignora
    const r = data[offset]!
    const g = data[offset + 1]!
    const b = data[offset + 2]!
    const key = `${Math.floor(r / COLOR_BUCKET_SIZE)}-${Math.floor(g / COLOR_BUCKET_SIZE)}-${Math.floor(b / COLOR_BUCKET_SIZE)}`
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.count += 1
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      buckets.set(key, { count: 1, r, g, b })
    }
  }

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count)
  if (sorted.length === 0) return { primary: '#0EA5E9', secondary: null }

  const toAvgRgb = (bucket: { count: number; r: number; g: number; b: number }): RGB => ({
    r: bucket.r / bucket.count,
    g: bucket.g / bucket.count,
    b: bucket.b / bucket.count,
  })

  const primaryRgb = toAvgRgb(sorted[0]!)
  const secondaryBucket = sorted.find((bucket) => colorDistance(toAvgRgb(bucket), primaryRgb) > MIN_SECONDARY_DISTANCE)

  return {
    primary: toHex(primaryRgb),
    secondary: secondaryBucket ? toHex(toAvgRgb(secondaryBucket)) : null,
  }
}
