import { isAllowedPhotoUrl } from '../diagnosis/photos'

/** Confirma que cada foto realmente está no Storage (HEAD no nosso host). Foto que sumiu NÃO bloqueia: só fica de fora e o técnico é avisado. */
export async function verifyStoredMedia(urls: string[], allowedHosts: string[], fetchImpl: typeof fetch = fetch): Promise<{ present: string[]; missing: string[] }> {
  const unique = [...new Set(urls)]
  const ok: boolean[] = new Array(unique.length).fill(false)
  let next = 0
  const worker = async () => {
    while (next < unique.length) {
      const i = next++
      const url = unique[i]!
      if (!isAllowedPhotoUrl(url, allowedHosts)) continue
      try {
        const res = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
        ok[i] = res.ok
      } catch {
        ok[i] = false
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker))
  return { present: unique.filter((_, i) => ok[i]), missing: unique.filter((_, i) => !ok[i]) }
}

export function storageHosts(): string[] {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? [new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname] : []
  } catch {
    return []
  }
}
