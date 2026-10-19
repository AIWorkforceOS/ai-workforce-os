import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { randomUUID } from 'node:crypto'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { isQuoteTeamKillSwitchOn, ROUTE_TIME_BUDGET_MS } from '@/lib/quote-team/config'
import { QUOTE_STAGE_HANDLERS } from '@/lib/quote-team/handlers'
import { SupabaseJobStore } from '@/lib/quote-team/job-store'
import { resolveQuoteJobAccess } from '@/lib/quote-team/access'
import { isPipelineReady, runQuoteJob } from '@/lib/quote-team/runner'
import { isRunnerAuthorized } from '@/lib/quote-team/runner-auth'
import { toAdminJobStatus, toTechnicianJobStatus } from '@/lib/quote-team/visibility'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Dispara/retoma a análise de UM job logo depois de salvar (a tela chama e acompanha pelo GET). Se a aba fechar, o cron
 * por minuto retoma. Cada passada respeita o limite de tempo e devolve o job com tudo gravado. Idempotente: se outro worker
 * já está com o job (lease), responde com o estado atual.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Disparo imediato pelo SERVIDOR (logo após salvar a ordem): não depende de navegador aberto. Responde 202 na hora e processa em
  // segundo plano (waitUntil) numa invocação própria de até 300 s; se algo cair, o cron por minuto retoma sem refazer etapas nem cobrar de novo.
  if (isRunnerAuthorized(request)) {
    if (isQuoteTeamKillSwitchOn() || !isPipelineReady(QUOTE_STAGE_HANDLERS)) return NextResponse.json({ error: 'Análise indisponível.' }, { status: 409 })
    const serviceDb = createServiceClient()
    if (!serviceDb) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 503 })
    waitUntil(
      runQuoteJob({ store: new SupabaseJobStore(serviceDb), handlers: QUOTE_STAGE_HANDLERS, worker: `kick-${randomUUID().slice(0, 8)}`, timeBudgetMs: ROUTE_TIME_BUDGET_MS }, id).catch((error) => {
        console.error(`[quote-team] passada imediata falhou: ${error instanceof Error ? error.message : String(error)}`)
      }),
    )
    return NextResponse.json({ accepted: true }, { status: 202 })
  }

  const appUser = await getAppUser()
  if (!appUser) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (isQuoteTeamKillSwitchOn() || !isPipelineReady(QUOTE_STAGE_HANDLERS)) return NextResponse.json({ error: 'Análise indisponível.' }, { status: 409 })

  const db = createServiceClient()
  if (!db) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 503 })
  const store = new SupabaseJobStore(db)

  const job = await store.get(id)
  if (!job) return NextResponse.json({ error: 'Não encontrado.' }, { status: 404 })
  const { data: appointment } = await db.from('appointments').select('employee_id').eq('id', job.appointment_id).maybeSingle()
  const access = resolveQuoteJobAccess(appUser, job, (appointment as { employee_id: string | null } | null)?.employee_id ?? null)
  if (access === 'none') return NextResponse.json({ error: 'Não encontrado.' }, { status: 404 })

  const outcome = await runQuoteJob({ store, handlers: QUOTE_STAGE_HANDLERS, worker: `web-${randomUUID().slice(0, 8)}`, timeBudgetMs: ROUTE_TIME_BUDGET_MS }, id)
  const current = (await store.get(id)) ?? job
  return NextResponse.json({ outcome: outcome.kind, job: access === 'admin' ? toAdminJobStatus(current) : toTechnicianJobStatus(current) }, { headers: { 'Cache-Control': 'no-store' } })
}
