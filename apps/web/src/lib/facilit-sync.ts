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

/**
 * Motivo de uma ordem NÃO ter virado appointment nesta sync — sem isso o
 * drop é silencioso (mapFacilitOrder e filterOrdersForTodayAndTomorrow só
 * excluem, nunca lançam erro). Descoberto em produção (Mawi Pro,
 * 2026-09-15): de 5 ordens reais só 4 entraram, sem nenhum sinal de qual
 * ficou de fora ou por quê.
 */
export type FacilitSyncSkipReason = 'sem_numero_ordem' | 'fora_de_hoje_amanha' | 'falha_ao_salvar'
export type FacilitSyncSkip = {
  orderNumber: string | null
  /** Vendor PO# / Client PO# — é isso que aparece como "número da ordem" na tela do app da Facil-IT, não o `orderNumber` interno. */
  poNumber: string | null
  clientPo: string | null
  company: string | null
  reason: FacilitSyncSkipReason
  detail?: string
}
export type FacilitSyncResult = {
  /** Total de ordens que a API da Facil-IT devolveu nesta chamada, de qualquer data — serve pra conferir na hora se a API já veio incompleta (antes de qualquer filtro nosso). */
  found: number
  imported: number
  error: string | null
  skipped: FacilitSyncSkip[]
}

/**
 * Cliente "360 Service Provider" da unidade — cria na primeira vez,
 * reaproveita depois (mesmo padrão de resolveClientTargetCustomer do
 * Portal 360, mas keyed por unit_id em vez de client_company sozinho,
 * já que aqui não existe login do cliente externo, só o sync).
 *
 * Bug real (2026-09-16, achado com o Vinicius): sem `.order().limit(1)`,
 * um `.maybeSingle()` sozinho ERRA quando existe mais de uma linha
 * correspondente (PostgREST recusa "múltiplas linhas" pra esse método)
 * — e o erro fica silencioso aqui (só `data` é desestruturado, nunca
 * `error`), então `existing` vira null e a função cria MAIS um cliente
 * novo. Isso se autoalimenta: uma vez que 2 linhas existem (aconteceu
 * por uma corrida entre dois syncs simultâneos), toda sync seguinte
 * nunca mais encontra "exatamente uma" e cria outra — em poucos dias
 * a unidade acumulou 17 clientes "360 Service Provider" duplicados.
 * `.order(...).limit(1)` (mesmo padrão já usado em
 * resolveClientTargetCustomer, lib/portal-360/data.ts) nunca erra desse
 * jeito — sempre pega a mais antiga entre quantas existirem.
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
    .order('created_at', { ascending: true })
    .limit(1)
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

    const skipped: FacilitSyncSkip[] = []
    const mapped: MappedFacilitOrder[] = []
    for (const raw of rawOrders) {
      const order = mapFacilitOrder(raw)
      if (order) {
        mapped.push(order)
      } else {
        skipped.push({
          orderNumber: raw.orderNumber !== undefined && raw.orderNumber !== null ? String(raw.orderNumber) : null,
          poNumber: raw.poNumber ?? null,
          clientPo: raw.clientPO ?? raw.clientPoNumber ?? null,
          company: raw.company ?? null,
          reason: 'sem_numero_ordem',
        })
      }
    }

    const due = filterOrdersForTodayAndTomorrow(mapped, unit.timezone)
    const dueOrderNumbers = new Set(due.map((o) => o.facilit_order_number))
    for (const order of mapped) {
      if (!dueOrderNumbers.has(order.facilit_order_number)) {
        skipped.push({
          orderNumber: order.facilit_order_number,
          poNumber: order.po_number,
          clientPo: order.client_po,
          company: order.company,
          reason: 'fora_de_hoje_amanha',
          detail: order.visit_date ? `visita em ${order.visit_date}` : 'sem data de visita reconhecida',
        })
      }
    }

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

      if (error || !workOrder) {
        skipped.push({
          orderNumber: order.facilit_order_number,
          poNumber: order.po_number,
          clientPo: order.client_po,
          company: order.company,
          reason: 'falha_ao_salvar',
          detail: error?.message,
        })
        continue
      }
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

    if (skipped.length > 0) {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'cron',
        eventType: 'facilit_sync_orders_skipped',
        message: `Sync da Facil-IT (unidade "${unit.name}"): ${rawOrders.length} ordem(ns) recebida(s) da API, ${imported} importada(s), ${skipped.length} ignorada(s) — ${skipped
          .map(
            (s) =>
              `PO ${s.poNumber ?? '(sem PO)'}${s.orderNumber ? ` / ordem interna ${s.orderNumber}` : ''}${s.company ? ` "${s.company}"` : ''}: ${s.reason}${s.detail ? ` (${s.detail})` : ''}`,
          )
          .join('; ')}`,
        orgId: unit.org_id,
        unitId: unit.id,
      })
    }

    return { found: rawOrders.length, imported, error: null, skipped }
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

    return { found: 0, imported: 0, error: message, skipped: [] }
  }
}
