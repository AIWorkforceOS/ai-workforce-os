import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { SupabaseJobStore } from '@/lib/quote-team/job-store'
import { resolveQuoteJobAccess } from '@/lib/quote-team/access'
import { toAdminJobStatus, toTechnicianJobStatus } from '@/lib/quote-team/visibility'

export const dynamic = 'force-dynamic'

/**
 * Progresso da análise da cotação. Técnico recebe SÓ andamento/pendências (sem custos de IA); admin recebe também custos.
 * Quem não pode ver (outro técnico, outra empresa, cliente do Portal 360, ou técnico em modo sombra) recebe 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const appUser = await getAppUser()
  if (!appUser) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const db = createServiceClient()
  if (!db) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 503 })

  const job = await new SupabaseJobStore(db).get(id)
  if (!job) return NextResponse.json({ error: 'Não encontrado.' }, { status: 404 })

  const { data: appointment } = await db.from('appointments').select('employee_id').eq('id', job.appointment_id).maybeSingle()
  const access = resolveQuoteJobAccess(appUser, job, (appointment as { employee_id: string | null } | null)?.employee_id ?? null)
  if (access === 'none') return NextResponse.json({ error: 'Não encontrado.' }, { status: 404 })

  return NextResponse.json({ job: access === 'admin' ? toAdminJobStatus(job) : toTechnicianJobStatus(job) }, { headers: { 'Cache-Control': 'no-store' } })
}
