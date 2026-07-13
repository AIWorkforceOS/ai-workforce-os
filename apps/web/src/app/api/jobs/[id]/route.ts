import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getAppUser } from '@/lib/app-user'
import { getRecruiterConfig } from '@/lib/recruiter/guardrails'
import { logDecision, logRecruiterEvent } from '@/lib/recruiter/log'
import { startIntake } from '@/lib/recruiter/intake-engine'
import { runSourcing } from '@/lib/recruiter/sourcing-engine'
import { sendOutreachBatch } from '@/lib/recruiter/screening-engine'
import { cancelJob, finalizeSelection } from '@/lib/recruiter/orchestrator'
import type { Lead, Unit } from '@/lib/types'
import type { JobOpening } from '@/lib/recruiter/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/jobs/[id] — detalhe completo da vaga (RLS pela sessão):
 * vaga + pipeline de candidatos + decision log + eventos.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const appUser = await getAppUser()
  if (!appUser) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const supabase = await createClient()
  const [{ data: job }, { data: candidates }, { data: decisions }, { data: events }] =
    await Promise.all([
      supabase.from('job_openings').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('job_candidates')
        .select('*, candidates(*)')
        .eq('job_id', id)
        .order('rank', { ascending: true, nullsFirst: false }),
      supabase
        .from('recruiter_decisions')
        .select('*')
        .eq('job_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('recruiter_events')
        .select('*')
        .eq('job_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

  if (!job) return NextResponse.json({ error: 'Vaga não encontrada ou sem acesso.' }, { status: 404 })

  return NextResponse.json({ job, candidates: candidates ?? [], decisions: decisions ?? [], events: events ?? [] })
}

/**
 * PATCH /api/jobs/[id] — ações humanas sobre o processo (§12.4):
 *   { action: 'start_intake' | 'run_sourcing' | 'send_outreach' | 'pause'
 *           | 'resume' | 'cancel' | 'select_candidate' | 'return_to_recruiter'
 *           | 'update_profile',
 *     candidate_id?, profile?, reason? }
 * Acesso validado pela sessão (RLS); execução via service role.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const appUser = await getAppUser()
  if (!appUser) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (appUser.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão para agir sobre vagas.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const action: string | undefined = body?.action
  if (!action) return NextResponse.json({ error: 'action é obrigatória.' }, { status: 400 })

  const supabase = await createClient()
  const { data: jobData } = await supabase.from('job_openings').select('*').eq('id', id).maybeSingle()
  if (!jobData) return NextResponse.json({ error: 'Vaga não encontrada ou sem acesso.' }, { status: 404 })

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada.' }, { status: 500 })
  }

  const job = jobData as JobOpening
  const { data: unitData } = await service.from('units').select('*').eq('id', job.unit_id).maybeSingle()
  if (!unitData) return NextResponse.json({ error: 'Unidade da vaga não encontrada.' }, { status: 404 })
  const unit = unitData as Unit

  const config = await getRecruiterConfig(service, unit.id)
  const requireConfig = () => {
    if (!config || !config.is_active) {
      return NextResponse.json(
        { error: 'Agente Recruiter não configurado ou inativo nesta unidade (Unidades → Agente).' },
        { status: 400 },
      )
    }
    return null
  }

  try {
    switch (action) {
      case 'start_intake': {
        const configError = requireConfig()
        if (configError) return configError
        if (!job.lead_id) return NextResponse.json({ error: 'Vaga sem empresa (lead) vinculada.' }, { status: 400 })
        const { data: lead } = await service.from('leads').select('*').eq('id', job.lead_id).maybeSingle()
        if (!lead) return NextResponse.json({ error: 'Lead da vaga não encontrado.' }, { status: 404 })
        const started = await startIntake(service, { job, unit, config: config!, lead: lead as Lead })
        return NextResponse.json({ ok: started, message: started ? 'Intake iniciado.' : 'Não foi possível enviar a primeira mensagem (horário/limite/canal).' })
      }

      case 'run_sourcing': {
        const configError = requireConfig()
        if (configError) return configError
        const result = await runSourcing(service, { job, unit, config: config! })
        return NextResponse.json({ ok: true, result })
      }

      case 'send_outreach': {
        const configError = requireConfig()
        if (configError) return configError
        const result = await sendOutreachBatch(service, { job, unit, config: config! })
        return NextResponse.json({ ok: true, result })
      }

      case 'pause': {
        await service
          .from('job_openings')
          .update({ status: 'stalled', previous_status: job.status, stalled_since: new Date().toISOString() })
          .eq('id', job.id)
        await logDecision(service, {
          orgId: job.org_id, unitId: job.unit_id, jobId: job.id,
          decisionType: 'pause',
          reasoning: `Vaga pausada manualmente por ${appUser.email}${body?.reason ? `: ${body.reason}` : ''}.`,
        })
        return NextResponse.json({ ok: true })
      }

      case 'resume':
      case 'return_to_recruiter': {
        const backTo = job.previous_status && job.previous_status !== 'escalated_human' ? job.previous_status : 'profiling'
        await service
          .from('job_openings')
          .update({ status: backTo, previous_status: null, stalled_since: null })
          .eq('id', job.id)
        await logDecision(service, {
          orgId: job.org_id, unitId: job.unit_id, jobId: job.id,
          decisionType: 'resume',
          reasoning: `Processo devolvido ao Recruiter por ${appUser.email} (estado retomado: ${backTo})${body?.reason ? `. Contexto: ${body.reason}` : ''}.`,
        })
        await logRecruiterEvent(service, {
          orgId: job.org_id, unitId: job.unit_id, jobId: job.id,
          eventType: 'job.resumed',
          message: `Devolvido ao agente por ${appUser.email}.`,
        })
        return NextResponse.json({ ok: true, status: backTo })
      }

      case 'cancel': {
        if (!config) {
          await service.from('job_openings').update({ status: 'cancelled' }).eq('id', job.id)
          return NextResponse.json({ ok: true })
        }
        await cancelJob(service, {
          job, unit, config,
          reason: `Cancelada por ${appUser.email}${body?.reason ? `: ${body.reason}` : ''}.`,
        })
        return NextResponse.json({ ok: true })
      }

      case 'select_candidate': {
        const configError = requireConfig()
        if (configError) return configError
        const jcId: string | undefined = body?.candidate_id
        if (!jcId) return NextResponse.json({ error: 'candidate_id (id do job_candidate) é obrigatório.' }, { status: 400 })
        const result = await finalizeSelection(service, {
          job, unit, config: config!,
          selectedJcId: jcId,
          decidedBy: `dashboard, por ${appUser.email}`,
        })
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
        return NextResponse.json({ ok: true })
      }

      case 'update_profile': {
        if (!body?.profile || typeof body.profile !== 'object') {
          return NextResponse.json({ error: 'profile é obrigatório.' }, { status: 400 })
        }
        const merged = { ...job.profile, ...body.profile }
        await service.from('job_openings').update({ profile: merged }).eq('id', job.id)
        await logRecruiterEvent(service, {
          orgId: job.org_id, unitId: job.unit_id, jobId: job.id,
          eventType: 'job.profile_edited',
          message: `Perfil da vaga editado por ${appUser.email}.`,
        })
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ error: `Ação desconhecida: ${action}` }, { status: 400 })
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao executar a ação.' },
      { status: 500 },
    )
  }
}
