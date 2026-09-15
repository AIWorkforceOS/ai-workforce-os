import { deletePendingSave, listPendingSaves, type PendingSave } from './offline-store'

/**
 * Reenvia um salvamento guardado localmente pra rota que ele já tentou
 * bater antes (a mesma PATCH de sempre, ver
 * app/api/units/[id]/appointments/[appointmentId]/service-order/route.ts)
 * — reconstrói o FormData original a partir do que foi guardado.
 *
 * 'retry': falha de rede (ainda sem internet) — mantém guardado, tenta
 * de novo na próxima sincronização.
 * 'dropped': o servidor respondeu (chegou a rede), mas rejeitou o
 * salvamento por algum motivo real (ex.: ordem foi excluída nesse
 * meio-tempo) — tentar de novo não vai resolver, então descarta em vez
 * de ficar tentando pra sempre. Perda de dado nesse caso é aceitável:
 * o problema não é falta de internet, que é o que esta fila resolve.
 */
async function trySyncOne(item: PendingSave): Promise<'synced' | 'dropped' | 'retry'> {
  const formData = new FormData()
  for (const [key, value] of Object.entries(item.fields)) formData.set(key, value)
  for (const [fieldName, files] of Object.entries(item.files)) {
    for (const stored of files) {
      formData.append(fieldName, new File([stored.blob], stored.name, { type: stored.type }))
    }
  }

  try {
    const response = await fetch(`/api/units/${item.unitId}/appointments/${item.appointmentId}/service-order`, {
      method: 'PATCH',
      body: formData,
    })
    return response.ok ? 'synced' : 'dropped'
  } catch {
    return 'retry'
  }
}

export type DrainResult = { synced: number; dropped: number; remaining: number }

/** Percorre a fila inteira (todas as ordens, não só a que está aberta) e tenta reenviar cada item. */
export async function drainPendingSaves(): Promise<DrainResult> {
  const items = await listPendingSaves()
  let synced = 0
  let dropped = 0

  for (const item of items) {
    const result = await trySyncOne(item)
    if (result === 'retry') continue
    await deletePendingSave(item.id)
    if (result === 'synced') synced += 1
    else dropped += 1
  }

  const remaining = await listPendingSaves()
  return { synced, dropped, remaining: remaining.length }
}
