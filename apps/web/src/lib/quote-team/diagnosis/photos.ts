import sharp from 'sharp'
import { DIAGNOSIS_IMAGE_MAX_SIDE, DIAGNOSIS_MAX_PHOTOS } from '../config'

export type PreparedImage = {
  /** posição entre as imagens ENVIADAS ao modelo (é a que `photo_refs` usa) */
  index: number
  sourceUrl: string
  dataUrl: string
  width: number
  height: number
  bytes: number
}

export type UnreadablePhoto = { url: string; reason: string }

/** Só baixamos fotos do NOSSO Storage (https + host permitido): um job adulterado não vira ferramenta para buscar endereços internos/externos. */
export function isAllowedPhotoUrl(url: string, allowedHosts: string[]): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && allowedHosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}

/** Escolhe as fotos que vão ao modelo (padrão até 8): mantém a ordem em que o técnico as enviou. */
export function selectPhotos(urls: string[], max = DIAGNOSIS_MAX_PHOTOS): { selected: string[]; skippedOverLimit: number } {
  const unique = [...new Set(urls)]
  return { selected: unique.slice(0, max), skippedOverLimit: Math.max(0, unique.length - max) }
}

/** Gira pelo EXIF, reduz (custo e velocidade) e entrega como data URL JPEG — o arquivo original nunca é alterado. */
export async function prepareImage(input: Buffer, maxSide = DIAGNOSIS_IMAGE_MAX_SIDE): Promise<{ dataUrl: string; width: number; height: number; bytes: number }> {
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  return { dataUrl: `data:image/jpeg;base64,${data.toString('base64')}`, width: info.width, height: info.height, bytes: data.length }
}

export type LoadPhotosDeps = {
  fetchImpl?: typeof fetch
  allowedHosts: string[]
  maxPhotos?: number
  maxSide?: number
  timeoutMs?: number
  concurrency?: number
}

/** Baixa e prepara as fotos. Foto ilegível/inacessível NÃO derruba a análise: vira aviso para o técnico. */
export async function loadPhotos(urls: string[], deps: LoadPhotosDeps): Promise<{ images: PreparedImage[]; unreadable: UnreadablePhoto[]; skippedOverLimit: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const { selected, skippedOverLimit } = selectPhotos(urls, deps.maxPhotos)
  const unreadable: UnreadablePhoto[] = []
  const results: (Omit<PreparedImage, 'index'> | null)[] = new Array(selected.length).fill(null)

  let next = 0
  const worker = async () => {
    while (next < selected.length) {
      const i = next++
      const url = selected[i]!
      if (!isAllowedPhotoUrl(url, deps.allowedHosts)) {
        unreadable.push({ url, reason: 'endereço não permitido' })
        continue
      }
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const prepared = await prepareImage(Buffer.from(await res.arrayBuffer()), deps.maxSide)
        results[i] = { sourceUrl: url, ...prepared }
      } catch (error) {
        unreadable.push({ url, reason: error instanceof Error ? error.message.slice(0, 120) : 'erro desconhecido' })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? 3, selected.length) }, worker))

  const images = results.filter((r): r is Omit<PreparedImage, 'index'> => r !== null).map((r, index) => ({ ...r, index }))
  return { images, unreadable, skippedOverLimit }
}
