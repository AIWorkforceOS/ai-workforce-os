import type { SupabaseClient } from '@supabase/supabase-js'
import { facilitLogin, fetchFacilitOrders, mapFacilitOrder, filterOrdersForTodayAndTomorrow, FacilitAuthError } from './facilit'
import { logSystemEvent } from './system-events'
import type { Unit } from './types'

export type FacilitCredentialRow = {
  id: string
  org_id: string
  unit_id: string
  client_code: string
  username: string
  password: string
  is_active: boolean
}

export type FacilitSyncResult = { imported: number; error: string | null }

/**
 * Sync de uma unidade: login na Facil-IT, busca ordens, filtra hoje+amanhã
 * no fuso da unidade e faz upsert em facilit_work_orders (chave
 * unit_id+facilit_order_number — reimportar a mesma ordem atualiza os
 * dados em vez de duplicar, mas NUNCA mexe em assigned_employee_id de uma
 * ordem já atribuída, pra não desfazer uma escolha que o cliente já fez).
 * Usado tanto pelo cron diário quanto pelo botão "buscar agora" manual.
 */
export async function syncFacilitOrdersForUnit(
  supabase: SupabaseClient,
  unit: Unit,
  credential: FacilitCredentialRow,
): Promise<FacilitSyncResult> {
  try {
    const session = await facilitLogin({
      clientCode: credential.client_code,
      username: credential.username,
      password: credential.password,
    })
    const rawOrders = await fetchFacilitOrders(session)
    const mapped = rawOrders.map(mapFacilitOrder).filter((o): o is NonNullable<typeof o> => o !== null)
    const due = filterOrdersForTodayAndTomorrow(mapped, unit.timezone)

    let imported = 0
    for (const order of due) {
      const { error } = await supabase
        .from('facilit_work_orders')
        .upsert(
          {
            org_id: unit.org_id,
            unit_id: unit.id,
            facilit_order_number: order.facilit_order_number,
            po_number: order.po_number,
            client_po: order.client_po,
            company: order.company,
            address1: order.address1,
            address2: order.address2,
            city: order.city,
            state: order.state,
            zip: order.zip,
            phone: order.phone,
            category: order.category,
            order_type: order.order_type,
            priority: order.priority,
            status: order.status,
            requested_at: order.requested_at,
            visit_date: order.visit_date,
            latitude: order.latitude,
            longitude: order.longitude,
            scope: order.scope,
            raw: order.raw,
            imported_at: new Date().toISOString(),
          },
          { onConflict: 'unit_id,facilit_order_number' },
        )
      if (!error) imported += 1
    }

    await supabase
      .from('facilit_credentials')
      .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
      .eq('id', credential.id)

    return { imported, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido ao sincronizar com a Facil-IT.'
    const isAuthError = error instanceof FacilitAuthError

    await supabase.from('facilit_credentials').update({ last_sync_error: message }).eq('id', credential.id)
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'cron',
      eventType: isAuthError ? 'facilit_sync_auth_failed' : 'facilit_sync_failed',
      message: `Falha ao sincronizar ordens da Facil-IT (unidade "${unit.name}"): ${message}`,
      orgId: unit.org_id,
      unitId: unit.id,
    })

    return { imported: 0, error: message }
  }
}
