import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logSystemEvent } from '@/lib/system-events'
import { syncFranquiaCrmLeads } from '@/lib/sales/franquia-crm-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Sincronização diária dos leads parados no CRM de Franquias da Smarter
 * (Vercel Cron, ver vercel.json) — puxa leads `?stale=true` (situacao=ativo,
 * nunca/pouco contatados) e faz upsert em `leads` com
 * status='imported_pending_review', pra revisão humana antes de qualquer
 * contato automático (ver lib/sales/franquia-crm-sync.ts pro porquê).
 *
 * Não depende de active_hours — é sincronização de dados em lote, não envio
 * de mensagem (mesmo raciocínio já aplicado aos crons de Content/SEO em
 * 2026-08-13: active_hours é sobre disponibilidade de RESPOSTA, não se
 * aplica aqui).
 *
 * Env vars:
 *   CRON_SECRET                 — obrigatório (Vercel envia como Bearer token)
 *   SMARTER_FRANQUIA_CRM_TOKEN  — token de parceiro nível rede da Smarter
 *   SMARTER_FRANQUIA_CRM_UNIT_ID — unit da Alizo dona desses leads
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') ?? ''

  if (!cronSecret) {
    console.error('[cron/smarter-franquia-crm-sync] CRON_SECRET não configurado — cron desabilitado.')
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    console.error('[cron/smarter-franquia-crm-sync] SUPABASE_SERVICE_ROLE_KEY não configurada.')
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const result = await syncFranquiaCrmLeads(supabase)

  if (!result.ok) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'smarter_franquia_crm',
      eventType: 'smarter_franquia_crm_cron_failed',
      message: `Cron de sincronização do CRM de Franquias falhou: ${result.reason ?? 'erro desconhecido'}.`,
    })
    return NextResponse.json(result, { status: 500 })
  }

  return NextResponse.json(result)
}
