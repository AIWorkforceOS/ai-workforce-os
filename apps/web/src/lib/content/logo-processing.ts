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

function pixelAt(data: Buffer, width: number, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const offset = (y * width + x) * 4
  return { r: data[offset]!, g: data[offset + 1]!, b: data[offset + 2]!, a: data[offset + 3]! }
}

function countOpaque(data: Buffer, pixelCount: number): number {
  let count = 0
  for (let i = 0; i < pixelCount; i++) {
    if (data[i * 4 + 3]! >= 128) count += 1
  }
  return count
}

const BG_THRESHOLD = 32
const BG_SOFT_BAND = 20
const PROBE_RUN_LENGTH = 8
const PROBE_RUN_TOLERANCE = 10
const CLUSTER_TOLERANCE = 30
const MIN_REMAINING_OPAQUE_FRACTION = 0.02
const MIN_REMAINING_OPAQUE_PIXELS = 8

/**
 * Anda na diagonal a partir de um canto até achar uma sequência estável de
 * pixels opacos parecidos entre si — pula direto qualquer sombra/anti-alias
 * fino na borda de um emblema/badge (que teria cor intermediária, nem fundo
 * nem arte) e pousa na cor real do preenchimento de fundo.
 */
function probeBackgroundColor(data: Buffer, width: number, height: number, dx: number, dy: number): RGB | null {
  let x = dx > 0 ? 0 : width - 1
  let y = dy > 0 ? 0 : height - 1
  const maxSteps = Math.min(width, height)
  let run: RGB[] = []
  for (let i = 0; i < maxSteps; i++) {
    const p = pixelAt(data, width, x, y)
    if (p.a >= 250) {
      const last = run[run.length - 1]
      if (!last || colorDistance(p, last) < PROBE_RUN_TOLERANCE) {
        run.push(p)
      } else {
        run = [p]
      }
      if (run.length >= PROBE_RUN_LENGTH) return averageColor(run)
    } else {
      run = []
    }
    x += dx
    y += dy
  }
  return run.length > 0 ? averageColor(run) : null
}

/**
 * Remove o fundo sólido do logo (heurística de chroma-key, cor obtida pelos
 * 4 cantos). Um logo tipo "emblema/badge" pode já ter uma margem transparente
 * de verdade em volta (canvas retangular sobrando de um desenho circular) e
 * ainda assim ter um disco de cor sólida por remover por dentro dela — por
 * isso a amostragem anda pra dentro a partir do canto em vez de olhar só o
 * pixel exato do canto, e usa o voto da maioria dos 4 cantos (em vez da
 * média direta) pra não deixar um canto que caiu em cima da própria arte
 * estragar a leitura da cor de fundo.
 *
 * Nunca deixa a remoção apagar quase todo o conteúdo opaco: se sobrar pouco
 * (sinal de que a "cor de fundo" identificada era na verdade a própria arte,
 * não um fundo real), devolve a imagem original sem mexer.
 */
export async function removeSolidBackground(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  if (channels < 4 || width < 2 || height < 2) return input

  const pixelCount = width * height
  const opaqueBefore = countOpaque(data, pixelCount)
  if (opaqueBefore === 0) return input // nada opaco pra processar

  const samples = [
    probeBackgroundColor(data, width, height, 1, 1),
    probeBackgroundColor(data, width, height, -1, 1),
    probeBackgroundColor(data, width, height, 1, -1),
    probeBackgroundColor(data, width, height, -1, -1),
  ].filter((s): s is RGB => s !== null)
  if (samples.length === 0) return input

  let bestCluster = [samples[0]!]
  for (const candidate of samples) {
    const cluster = samples.filter((s) => colorDistance(s, candidate) < CLUSTER_TOLERANCE)
    if (cluster.length > bestCluster.length) bestCluster = cluster
  }
  const minAgreement = samples.length >= 4 ? 3 : samples.length
  if (bestCluster.length < minAgreement) return input // cantos não concordam — provavelmente não é fundo sólido

  const bgColor = averageColor(bestCluster)

  const out = Buffer.from(data)
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4
    if (data[offset + 3]! < 16) continue // já transparente
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

  const remainingOpaque = countOpaque(out, pixelCount)
  const minRemaining = Math.max(MIN_REMAINING_OPAQUE_PIXELS, Math.round(opaqueBefore * MIN_REMAINING_OPAQUE_FRACTION))
  if (remainingOpaque < minRemaining) return input // teria apagado quase tudo — a "cor de fundo" achada era a própria arte

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
