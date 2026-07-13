import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getAppUser } from '@/lib/app-user'
import { getRecruiterConfig } from '@/lib/recruiter/guardrails'
import { logRecruiterEvent } from '@/lib/recruiter/log'
import { startIntake } from '@/lib/recruiter/intake-engine'
import { isWithinActiveHours } from '@/lib/conversation-engine'
import type { Lead, Unit } from '@/lib/types'
import type { JobOpening } from '@/lib/recruiter/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/jobs — criação de vaga (handoff Sales → Recruiter, §7.1).
 * Chamado pelo botão "Abrir vaga" do CRM (lead won) ou manualmente.
 * Escrita via sessão (RLS decide o acesso); side-effects (intake) via
 * service role. Se o agente estiver fora do horário ativo, a vaga fica
 * em draft e o cron diário inicia o intake no próximo slot.
 */
export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }
  if (appUser.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão para criar vagas.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const unitId: string | undefined = body?.unit_id
  const title: string | undefined = body?.title?.trim()
  const leadId: string | null = body?.lead_id ?? null

  if (!unitId || !title) {
    return NextResponse.json({ error: 'unit_id e title são obrigatórios.' }, { status: 400 })
  }

  const supabase = await createClient()

  // RLS: só devolve a unidade se o usuário tiver acesso a ela
  const { data: unit } = await supabase.from('units').select('*').eq('id', unitId).maybeSingle()
  if (!unit) {
    return NextResponse.json({ error: 'Unidade não encontrada ou sem acesso.' }, { status: 404 })
  }
  const unitRow = unit as Unit
  if (!unitRow.org_id) {
    return NextResponse.json({ error: 'Unidade sem organização vinculada.' }, { status: 400 })
  }

  const urgency = ['low', 'normal', 'high'].includes(body?.urgency) ? body.urgency : 'normal'

  const { data: job, error } = await supabase
    .from('job_openings')
    .insert({
      org_id: unitRow.org_id,
      unit_id: unitRow.id,
      lead_id: leadId,
      title,
      urgency,
      hiring_deadline: body?.hiring_deadline ?? null,
      target_shortlist_size: Number(body?.target_shortlist_size) >= 3 && Number(body?.target_shortlist_size) <= 5
        ? Number(body.target_shortlist_size)
        : 5,
      profile: body?.profile && typeof body.profile === 'object' ? body.profile : {},
      source: body?.source === 'sales_employee' ? 'sales_employee' : 'manual',
      status: 'draft',
    })
    .select('*')
    .single()

  if (error || !job) {
    return NextResponse.json(
      { error: `Não foi possível criar a vaga: ${error?.message ?? 'erro desconhecido'}` },
      { status: 500 },
    )
  }

  const jobRow = job as JobOpening
  const service = createServiceClient()

  if (service) {
    await logRecruiterEvent(service, {
      orgId: jobRow.org_id,
      unitId: jobRow.unit_id,
      jobId: jobRow.id,
      eventType: 'job.created',
      message: `Vaga "${jobRow.title}" criada por ${appUser.email} (${jobRow.source}).`,
    })

    // Inicia o intake imediatamente se houver agente ativo dentro do horário
    if (leadId) {
      const config = await getRecruiterConfig(service, unitRow.id)
      if (config?.is_active && isWithinActiveHours(config.active_hours)) {
        const { data: lead } = await service.from('leads').select('*').eq('id', leadId).maybeSingle()
        if (lead) {
          try {
            await startIntake(service, { job: jobRow, unit: unitRow, config, lead: lead as Lead })
          } catch (err) {
            console.error(
              `[api/jobs] intake inline falhou (cron reprocessa): ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true, job: jobRow }, { status: 201 })
}

/** GET /api/jobs?unit_id= — lista de vagas visíveis pela sessão (RLS). */
export async function GET(request: Request) {
  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const unitId = searchParams.get('unit_id')

  const supabase = await createClient()
  let query = supabase.from('job_openings').select('*').order('created_at', { ascending: false })
  if (unitId) query = query.eq('unit_id', unitId)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ jobs: data ?? [] })
}
