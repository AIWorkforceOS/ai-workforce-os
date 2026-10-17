import type { GeoFix } from './geolocation'
import type { FieldEventType, FieldEvents } from './field-time'
import { addPendingSave, listPendingSaves, localId } from './offline-store'
import { drainPendingSaves } from './offline-sync'

/**
 * Viagem / check-in / fim viram itens da MESMA fila local dos salvamentos
 * (fields.__event): guardados no aparelho primeiro, reenviados com backoff,
 * nunca perdidos por falta de sinal. O horário gravado é o do aparelho no
 * momento do toque (o servidor só o aceita se for plausível).
 */
export const EVENT_FIELD = '__event'

export type RecordedEvent = { type: FieldEventType; at: string; stored: boolean }

export async function recordFieldEvent(input: { unitId: string; appointmentId: string; type: FieldEventType; fix: GeoFix | null }): Promise<RecordedEvent> {
  const at = new Date().toISOString()
  const fields: Record<string, string> = { [EVENT_FIELD]: input.type, at }
  if (input.fix) {
    fields.lat = String(input.fix.lat)
    fields.lng = String(input.fix.lng)
    fields.accuracy = String(input.fix.accuracy)
  } else {
    // Registrado sem GPS (localização bloqueada/indisponível): o horário vale, a posição fica vazia e o admin vê "sem GPS".
    fields.no_gps = '1'
  }
  const stored = await addPendingSave({ id: localId(), unitId: input.unitId, appointmentId: input.appointmentId, fields, files: {} })
  if (stored) void drainPendingSaves({ ignoreBackoff: true }).catch(() => null)
  return { type: input.type, at, stored: Boolean(stored) }
}

/** Marcos ainda não enviados deste agendamento (pra tela mostrar o estado certo mesmo antes de sincronizar). */
export async function loadPendingFieldEvents(appointmentId: string): Promise<Partial<FieldEvents>> {
  const merged: Partial<FieldEvents> = {}
  for (const item of await listPendingSaves()) {
    if (item.appointmentId !== appointmentId || !item.fields[EVENT_FIELD]) continue
    const at = item.fields.at ?? new Date(item.createdAt).toISOString()
    if (item.fields[EVENT_FIELD] === 'trip_start') merged.trip_started_at = at
    if (item.fields[EVENT_FIELD] === 'check_in') merged.checked_in_at = at
    if (item.fields[EVENT_FIELD] === 'finish') merged.work_ended_at = at
  }
  return merged
}
