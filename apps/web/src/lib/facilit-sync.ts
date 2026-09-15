import type { SupabaseClient } from '@supabase/supabase-js'
import { facilitLogin, fetchFacilitOrders, mapFacilitOrder, filterOrdersForTodayAndTomorrow, FacilitAuthError, type MappedFacilitOrder } from './facilit'
import { buildFacilitAppointmentInsertRow, FACILIT_CUSTOMER_COMPANY_NAME } from './facilit-appointment'
import { summarizeFacilitOrderForTechnician } from './facilit-summary'
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
 * Cliente "360 Service Provider" da unidade — cria na primeira vez,
 * reaproveita depois (mesmo padrão de resolveClientTargetCustomer do
 * Portal 360, mas keyed por unit_id em vez de client_company sozinho,
 * já que aqui não existe login do cliente externo, só o sync).
 */
async function resolveFacilitCustomer(
  supabase: SupabaseClient,
  unit: Unit,
): Promise<{ id: string; unitId: string; orgId: string } | null> {
  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('unit_id', unit.id)
    .eq('client_company', FACILIT_CUSTOMER_COMPANY_NAME)
    .maybeSingle()

  if (existing) return { id: (existing as { id: string }).id, unitId: unit.id, orgId: unit.org_id! }

  const { data: created, error } = await supabase
    .from('customers')
    .insert({
      org_id: unit.org_id,
      unit_id: unit.id,
      name: FACILIT_CUSTOMER_COMPANY_NAME,
      client_company: FACILIT_CUSTOMER_COMPANY_NAME,
      source: 'facilit_sync',
      status: 'active',
    })
    .select('id')
    .single()

  if (error || !created) return null
  return { id: (created as { id: string }).id, unitId: unit.id, orgId: unit.org_id! }
}

/**
 * Cria o appointment real na agenda pra uma ordem recém-upsertada em
 * facilit_work_orders (linha ainda sem appointment_id). Nunca roda de
 * novo pra uma ordem que já tem appointment_id — reimportar a mesma
 * ordem em sync futuro não mexe no appointment que o admin já pode ter
 * atribuído/reagendado (mesmo espírito do que já valia pro
 * assigned_employee_id antes desta migration).
 *
 * Antes de criar, pede pra IA um resumo em português + dicas pro
 * técnico (summarizeFacilitOrderForTechnician) — pedido do Vinicius,
 * 2026-09-15. O texto original em inglês nunca é tocado (vai intacto
 * pra service_order_scope_en, é o que o cliente vê na loja); o resumo
 * é só um apoio a mais em service_order_summary_pt, já visível pro
 * técnico no Portal do Funcionário. Falha na IA nunca bloqueia o
 * import — o appointment é criado do mesmo jeito, só sem o resumo.
 */
async function ensureAppointmentForOrder(
  supabase: SupabaseClient,
  unit: Unit,
  order: MappedFacilitOrder,
  workOrderId: string,
): Promise<void> {
  const customer = await resolveFacilitCustomer(supabase, unit)
  if (!customer) return

  const summaryPt = await summarizeFacilitOrderForTechnician(order)
  const insertRow = buildFacilitAppointmentInsertRow({ order, customer, timezone: unit.timezone, summaryPt })
  const { data: appointment, error } = await supabase.from('appointments').insert(insertRow).select('id').single()
  if (error || !appointment) return

  await supabase
    .from('facilit_work_orders')
    .update({ appointment_id: (appointment as { id: string }).id })
    .eq('id', workOrderId)
}

/**
 * Sync de uma unidade: login na Facil-IT, busca ordens, filtra hoje+amanhã
 * no fuso da unidade, faz upsert em facilit_work_orders (chave
 * unit_id+facilit_order_number — dedup, nunca duplica a mesma ordem) e,
 * pra ordem nova (sem appointment_id ainda), cria a linha real em
 * `appointments` — é isso que o cliente vê e atribui pra um técnico
 * na tela normal da Agenda, sem passo extra nenhum daqui pra lá.
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
      const { data: workOrder, error } = await supabase
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
        .select('id, appointment_id')
        .single()

      if (error || !workOrder) continue
      imported += 1

      const row = workOrder as { id: string; appointment_id: string | null }
      if (!row.appointment_id) {
        await ensureAppointmentForOrder(supabase, unit, order, row.id)
      }
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
