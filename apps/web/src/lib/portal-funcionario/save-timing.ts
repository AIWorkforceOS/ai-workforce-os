/**
 * Medição por etapa do salvamento do Sign Off (só números: nenhum nome de arquivo, URL, id ou dado da ordem).
 * Guarda as últimas medições neste aparelho (localStorage) para diagnóstico de lentidão; nunca é enviado a lugar nenhum.
 */
export type SaveTiming = {
  at: string
  files: number
  megabytes: number
  /** ms por etapa; ausente = etapa não ocorreu */
  stages: Partial<Record<'gps' | 'store' | 'upload' | 'register' | 'final' | 'total', number>>
  outcome: 'synced' | 'queued' | 'failed' | 'not_stored'
}

const KEY = 'alizo_save_timings'
const MAX = 20

export function readSaveTimings(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): SaveTiming[] {
  try {
    const raw = storage?.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as SaveTiming[]) : []
  } catch {
    return []
  }
}

export function recordSaveTiming(entry: SaveTiming, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeStorage()): void {
  try {
    if (!storage) return
    const next = [...readSaveTimings(storage), entry].slice(-MAX)
    storage.setItem(KEY, JSON.stringify(next))
  } catch {
    // sem armazenamento (modo privado): a medição é opcional
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** Cronômetro simples de etapas. */
export function createStageTimer(now: () => number = () => Date.now()) {
  const start = now()
  const stages: SaveTiming['stages'] = {}
  return {
    add(stage: keyof SaveTiming['stages'], ms: number) {
      stages[stage] = Math.round((stages[stage] ?? 0) + Math.max(ms, 0))
    },
    async measure<T>(stage: keyof SaveTiming['stages'], fn: () => Promise<T>): Promise<T> {
      const t0 = now()
      try {
        return await fn()
      } finally {
        this.add(stage, now() - t0)
      }
    },
    finish(): SaveTiming['stages'] {
      return { ...stages, total: Math.round(now() - start) }
    },
  }
}
