import type { PendingSave } from './offline-store'

export type QueueItemView = {
  id: string
  appointmentId: string
  createdAt: number
  fileCount: number
  megabytes: number
  attempts: number
  state: 'waiting' | 'failed'
  label: string
}

const REASON_LABEL: Record<string, string> = {
  network: 'Aguardando internet',
  session: 'Sessão expirada — entre de novo no app (nada foi perdido)',
  too_large: 'Arquivos grandes — enviando em partes',
  rate_limited: 'Servidor pediu pra esperar — tenta sozinho',
  server: 'Servidor ocupado — tenta sozinho',
}

/** Traduz um item da fila pro que o técnico precisa ler: salvo no aparelho, esperando, ou falhou. */
export function describeQueueItem(item: PendingSave): QueueItemView {
  const files = Object.values(item.files).flat()
  const bytes = files.reduce((sum, f) => sum + f.blob.size, 0)
  const failed = item.status === 'failed'
  return {
    id: item.id,
    appointmentId: item.appointmentId,
    createdAt: item.createdAt,
    fileCount: files.length,
    megabytes: Math.round((bytes / 1048576) * 10) / 10,
    attempts: item.attempts ?? 0,
    state: failed ? 'failed' : 'waiting',
    label: failed
      ? `Falhou${item.lastHttpStatus ? ` (código ${item.lastHttpStatus})` : ''} — está guardado no aparelho, não foi apagado`
      : (item.lastError && REASON_LABEL[item.lastError]) || 'Salvo no aparelho — aguardando envio',
  }
}
