export type StorageStatus = { supported: boolean; usage: number; quota: number; free: number; persisted: boolean }

/** Espaço local estimado (Chrome e Safari informam; é uma ESTIMATIVA, não uma garantia). */
export async function getStorageStatus(): Promise<StorageStatus> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return { supported: false, usage: 0, quota: 0, free: Infinity, persisted: false }
    const estimate = await navigator.storage.estimate()
    const usage = estimate.usage ?? 0
    const quota = estimate.quota ?? 0
    const persisted = (await navigator.storage.persisted?.()) ?? false
    return { supported: quota > 0, usage, quota, free: quota > 0 ? Math.max(quota - usage, 0) : Infinity, persisted }
  } catch {
    return { supported: false, usage: 0, quota: 0, free: Infinity, persisted: false }
  }
}

/** Margem: o arquivo (x1,5 pelo custo do IndexedDB) + 25MB de folga pro sistema não ficar sem espaço. */
export function roomNeeded(bytes: number): number {
  return Math.ceil(bytes * 1.5) + 25 * 1024 * 1024
}

export function hasRoom(status: StorageStatus, bytes: number): boolean {
  return !status.supported || status.free >= roomNeeded(bytes)
}

/** Avisa antes que o espaço acabe: menos de 10% livre ou menos de 150MB. */
export function isStorageLow(status: StorageStatus): boolean {
  return status.supported && (status.free < 150 * 1024 * 1024 || (status.quota > 0 && status.free / status.quota < 0.1))
}

export const NO_SPACE_MESSAGE = 'O celular está sem espaço para guardar isso. Apague vídeos ou fotos antigas da galeria e tente de novo. Nada foi salvo ainda.'
