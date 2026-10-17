import { createClient } from '@/lib/supabase/client'
import { addPendingSave, listPendingSaves, type StoredFile } from './offline-store'
import { drainPendingSaves } from './offline-sync'
import { describeQueueItem } from './queue-status'

export const SERVICE_ORDER_PATCH_COLUMNS =
  'service_order_status, service_order_signed_by, service_order_signed_at, service_order_signature_url, service_order_part_purchase_link, service_order_material_description, service_order_material_value, service_order_hours_needed, service_order_photos'

export type LiveSaveResult =
  | { kind: 'synced'; patch: Record<string, unknown> | null }
  /** `label` = motivo real da espera (sem internet, sessão expirada, servidor ocupado…). */
  | { kind: 'queued'; label: string }
  | { kind: 'failed'; message: string }
  | { kind: 'not_stored' }

/**
 * Salvamento "ao vivo" no modo upload direto: SEMPRE guarda no aparelho
 * primeiro (IndexedDB) e só então envia pela fila (arquivos direto ao
 * Storage, nunca pelo corpo limitado da Vercel). Só resolve como 'synced'
 * quando o servidor confirmou e o item saiu da fila; qualquer outra coisa
 * deixa o trabalho guardado e visível. Desligado por padrão (ver
 * directMediaUploadEnabled).
 */
export async function saveViaQueue(input: {
  id: string
  unitId: string
  appointmentId: string
  fields: Record<string, string>
  files: Record<string, StoredFile[]>
}): Promise<LiveSaveResult> {
  const stored = await addPendingSave(input)
  if (!stored) return { kind: 'not_stored' }

  await drainPendingSaves({ force: true })

  const item = (await listPendingSaves()).find((entry) => entry.id === input.id)
  if (item?.status === 'failed') {
    return { kind: 'failed', message: item.lastError ?? 'O servidor recusou o salvamento. Seu trabalho continua guardado no aparelho.' }
  }
  if (item) return { kind: 'queued', label: describeQueueItem(item).label }

  // Confirmado e removido da fila: busca o estado atualizado pra tela refletir o que o servidor realmente tem.
  try {
    const { data } = await createClient().from('appointments').select(SERVICE_ORDER_PATCH_COLUMNS).eq('id', input.appointmentId).maybeSingle()
    return { kind: 'synced', patch: (data as Record<string, unknown> | null) ?? null }
  } catch {
    return { kind: 'synced', patch: null }
  }
}
