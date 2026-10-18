import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { isQuoteTeamKillSwitchOn } from '@/lib/quote-team/config'
import { QUOTE_STAGE_HANDLERS } from '@/lib/quote-team/handlers'
import { SupabaseJobStore } from '@/lib/quote-team/job-store'
import { isPipelineReady, runQuoteJob } from '@/lib/quote-team/runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Rede de segurança (a cada minuto): retoma jobs de análise de cotação parados — aba fechada, função que estourou o tempo,
 * tentativa com espera vencida, lease expirado. Sem etapas registradas (Fase 2) ou com o interruptor global desligado, responde
 * na hora SEM tocar no banco.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 })
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  if (isQuoteTeamKillSwitchOn() || !isPipelineReady(QUOTE_STAGE_HANDLERS)) return NextResponse.json({ skipped: 'pipeline_not_ready_or_disabled' })

  const db = createServiceClient()
  if (!db) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 503 })
  const store = new SupabaseJobStore(db)
  const worker = `cron-${randomUUID().slice(0, 8)}`
  const startedAt = Date.now()
  const outcomes: Record<string, number> = {}
  // Reservas presas (chamada que morreu no meio) viram "não confirmadas": continuam contando nos tetos, sem virar gasto real.
  const reconciled = await store.reconcileBudgets().catch(() => 0)

  for (let i = 0; i < 5 && Date.now() - startedAt < 200_000; i += 1) {
    const outcome = await runQuoteJob({ store, handlers: QUOTE_STAGE_HANDLERS, worker, timeBudgetMs: 200_000 - (Date.now() - startedAt) }, null)
    if (outcome.kind === 'not_claimed') break
    outcomes[outcome.kind] = (outcomes[outcome.kind] ?? 0) + 1
  }
  return NextResponse.json({ ran: outcomes, reconciled })
}
