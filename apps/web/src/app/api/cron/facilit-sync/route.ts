import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncFacilitOrdersForUnit, type FacilitCredentialRow } from '@/lib/facilit-sync'
import { logSystemEvent } from '@/lib/system-events'
import { fetchOrganizationFacilitEnabled } from '@/lib/organizations'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Sync diário automático das ordens da Facil-IT (pedido do Vinicius,
 * 2026-09-10, integração Mawi Pro/360): "todos os dias o sistema irá
 * verificar de forma automática novas ordens e trazer para o nosso
 * sistema". Roda 1x/dia (mesma limitação de cron do resto do produto —
 * ver manager-agenda-digest/route.ts) — o botão "buscar agora" cobre o
 * caso de precisar antes disso.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') ?? ''

  if (!cronSecret) {
    console.error('[cron/facilit-sync] CRON_SECRET não configurado — cron desabilitado.')
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    console.error('[cron/facilit-sync] SUPABASE_SERVICE_ROLE_KEY não configurada.')
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const { data: credentials } = await supabase.from('facilit_credentials').select('*').eq('is_active', true)
  const rows = (credentials ?? []) as FacilitCredentialRow[]

  let synced = 0
  let imported = 0
  let errors = 0

  for (const credential of rows) {
    const { data: unit } = await supabase.from('units').select('*').eq('id', credential.unit_id).single()
    if (!unit) continue
    // Defesa em profundidade: a integração é específica da Mawi Pro (migration 083) — mesmo que
    // uma credencial exista pra outra org (não devia, já que a criação também é bloqueada), pula.
    if (!(await fetchOrganizationFacilitEnabled(supabase, (unit as Unit).org_id))) continue

    const result = await syncFacilitOrdersForUnit(supabase, unit as Unit, credential)
    synced += 1
    imported += result.imported
    if (result.error) errors += 1
  }

  await logSystemEvent(supabase, {
    level: errors > 0 ? 'warning' : 'info',
    source: 'cron',
    eventType: 'facilit_sync_run',
    message: `Sync Facil-IT executado: ${synced} unidade(s), ${imported} ordem(ns) importada(s), ${errors} erro(s).`,
  })

  return NextResponse.json({ ok: true, synced, imported, errors })
}
