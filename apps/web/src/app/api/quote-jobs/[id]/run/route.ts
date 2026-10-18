import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { isQuoteTeamKillSwitchOn } from '@/lib/quote-team/config'
import { QUOTE_STAGE_HANDLERS } from '@/lib/quote-team/handlers'
import { SupabaseJobStore } from '@/lib/quote-team/job-store'
import { resolveQuoteJobAccess } from '@/lib/quote-team/access'
import { isPipelineReady, runQuoteJob } from '@/lib/quote-team/runner'
import { toAdminJobStatus, toTechnicianJobStatus } from '@/lib/quote-team/visibility'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Dispara/retoma a análise de UM job logo depois de salvar (a tela chama e acompanha pelo GET). Se a aba fechar, o cron
 * por minuto retoma. Cada passada respeita o limite de tempo e devolve o job com tudo gravado. Idempotente: se outro worker
 * já está com o job (lease), responde com o estado atual.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

  const outcome = await runQuoteJob({ store, handlers: QUOTE_STAGE_HANDLERS, worker: `web-${randomUUID().slice(0, 8)}` }, id)
  const current = (await store.get(id)) ?? job
  return NextResponse.json({ outcome: outcome.kind, job: access === 'admin' ? toAdminJobStatus(current) : toTechnicianJobStatus(current) }, { headers: { 'Cache-Control': 'no-store' } })
}
