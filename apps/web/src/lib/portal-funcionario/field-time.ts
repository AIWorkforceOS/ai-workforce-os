export type FieldEvents = { trip_started_at: string | null; checked_in_at: string | null; work_ended_at: string | null }
export type FieldState = 'not_started' | 'on_trip' | 'on_site' | 'done'

export function fieldState(e: FieldEvents): FieldState {
  if (e.work_ended_at && e.checked_in_at) return 'done'
  if (e.checked_in_at) return 'on_site'
  if (e.trip_started_at) return 'on_trip'
  return 'not_started'
}

function ms(from: string | null, to: string | null | number): number | null {
  if (!from || to == null) return null
  const diff = (typeof to === 'number' ? to : new Date(to).getTime()) - new Date(from).getTime()
  return Number.isFinite(diff) ? Math.max(diff, 0) : null
}

/** Tempos acumulados até `now`: viagem (início → check-in) e serviço (check-in → fim); o que ainda corre usa `now`. */
export function computeDurations(e: FieldEvents, now: number): { tripMs: number | null; serviceMs: number | null; totalMs: number | null } {
  const tripMs = e.trip_started_at ? ms(e.trip_started_at, e.checked_in_at ?? now) : null
  const serviceMs = e.checked_in_at ? ms(e.checked_in_at, e.work_ended_at ?? now) : null
  const totalMs = tripMs != null || serviceMs != null ? (tripMs ?? 0) + (serviceMs ?? 0) : null
  return { tripMs, serviceMs, totalMs }
}

/** 3725000 → "1h 02min 05s"; abaixo de 1h → "02min 05s"; abaixo de 1min → "05s". */
export function formatDuration(totalMs: number | null): string {
  if (totalMs == null) return '—'
  const total = Math.floor(totalMs / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (h > 0) return `${h}h ${pad(m)}min ${pad(s)}s`
  if (m > 0) return `${pad(m)}min ${pad(s)}s`
  return `${pad(s)}s`
}

/** Funcionário com check-in obrigatório só finaliza a ordem depois de fazer o check-in. */
export function canFinalizeOrder(requiresCheckin: boolean, checkedInAt: string | null | undefined): boolean {
  return !requiresCheckin || Boolean(checkedInAt)
}

export const FIELD_EVENT_TYPES = ['trip_start', 'check_in', 'finish'] as const
export type FieldEventType = (typeof FIELD_EVENT_TYPES)[number]
export function isFieldEventType(value: unknown): value is FieldEventType {
  return typeof value === 'string' && (FIELD_EVENT_TYPES as readonly string[]).includes(value)
}

export function mapsLink(lat: number | null, lng: number | null): string | null {
  return lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null
}
