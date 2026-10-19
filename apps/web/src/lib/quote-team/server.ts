import { isQuoteTeamKillSwitchOn } from './config'

/** Mídias usadas no diagnóstico: só fotos já REGISTRADAS no servidor (antes/depois/atendimento). Vídeo e nota fiscal ficam de fora na v1. */
export function diagnosisMediaUrls(photos: { url: string; kind?: string }[] | null | undefined): string[] {
  return (photos ?? []).filter((p) => !p.kind || p.kind === 'before' || p.kind === 'after' || p.kind === 'service').map((p) => p.url)
}

/**
 * Dispara o processamento do job AGORA, de servidor para servidor (não depende do navegador do técnico). Nunca lança: se falhar, o job
 * continua na fila e o cron por minuto o pega. A rota de execução responde 202 na hora e trabalha em segundo plano.
 */
export async function kickQuoteJob(origin: string, jobId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (!secret || isQuoteTeamKillSwitchOn()) return false
  try {
    const res = await fetchImpl(`${origin}/api/quote-jobs/${jobId}/run`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(4000) })
    return res.status === 202
  } catch {
    return false
  }
}
