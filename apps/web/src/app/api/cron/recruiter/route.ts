import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isWithinActiveHours } from '@/lib/conversation-engine'
import { getOpenAIApiKey } from '@/lib/openai'
import { logSystemEvent } from '@/lib/system-events'
import { logDecision, logRecruiterEvent } from '@/lib/recruiter/log'
import { getRecruiterLimits } from '@/lib/recruiter/guardrails'
import { startIntake, sendIntakeReminder } from '@/lib/recruiter/intake-engine'
import { runSourcing, syncSmarterCandidates, ensureCandidateEmbeddings } from '@/lib/recruiter/sourcing-engine'
import { sendOutreachBatch, nudgeSilentCandidates } from '@/lib/recruiter/screening-engine'
import { recalculateShortlist, escalateJob, getLeadForJob } from '@/lib/recruiter/orchestrator'
import { sendCompanyFollowUp } from '@/lib/recruiter/reporting'
import { getSmarterApiConfig } from '@/lib/recruiter/smarter-api'
import type { AgentConfig, Conversation, Unit } from '@/lib/types'
import type { JobOpening } from '@/lib/recruiter/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DAY_MS = 24 * 60 * 60 * 1000
/** Dias após a apresentação para cada follow-up à empresa (§7.7). */
const FOLLOW_UP_OFFSETS_DAYS = [2, 5, 9]
const MAX_SOURCING_PER_UNIT = 1
const MAX_INTAKES_PER_UNIT = 3

/**
 * GET /api/cron/recruiter — loop diário de reconciliação do Recruiter
 * Employee (§2.5, §8.5). Eventos (webhooks) movem o processo em tempo
 * real; este cron destrava o que os eventos não cobriram, na ordem de
 * prioridade da spec: prazos → intakes parados → sourcing pendente →
 * outreach/triagem → follow-ups de decisão → manutenção (sync Smarter).
 * Protegido por CRON_SECRET (mesmo padrão de /api/cron/follow-up).
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') ?? ''

  if (!cronSecret) {
    console.error('[cron/recruiter] CRON_SECRET não configurado — cron desabilitado.')
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada.' }, { status: 500 })
  }

  if (!getOpenAIApiKey()) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'cron',
      eventType: 'recruiter_cron_missing_openai',
      message: 'Cron do Recruiter abortado: OPENAI_API_KEY não está configurada.',
    })
    return NextResponse.json({ error: 'OPENAI_API_KEY não configurada.' }, { status: 500 })
  }

  const { data: configs } = await supabase
    .from('agent_configs')
    .select('*, units(*)')
    .eq('agent_type', 'recruiter')
    .eq('is_active', true)

  type ConfigWithUnit = AgentConfig & { units: Unit | null }
  const configRows = ((configs ?? []) as ConfigWithUnit[]).filter((row) => row.units && row.units.is_active)

  const stats = {
    expired: 0, intakesStarted: 0, remindersSent: 0, stalledMarked: 0,
    sourcingRuns: 0, outreachSent: 0, followUpsSent: 0, escalated: 0, errors: 0,
  }
  const syncedOrgs = new Set<string>()

  for (const config of configRows) {
    const unit = config.units as Unit
    const limits = getRecruiterLimits(config)

    const { data: jobsData } = await supabase
      .from('job_openings')
      .select('*')
      .eq('unit_id', unit.id)
      .not('status', 'in', '(closed,cancelled,expired,handed_off)')
      .order('created_at', { ascending: true })

    const jobs = ((jobsData as JobOpening[] | null) ?? [])

    // ── 1. Prazos vencidos (independe de horário ativo — não envia mensagem)
    const today = new Date().toISOString().slice(0, 10)
    for (const job of jobs) {
      if (job.hiring_deadline && job.hiring_deadline < today && !['candidate_selected', 'escalated_human'].includes(job.status)) {
        try {
          await supabase.from('job_openings').update({ status: 'expired' }).eq('id', job.id)
          await logDecision(supabase, {
            orgId: job.org_id, unitId: job.unit_id, jobId: job.id,
            decisionType: 'expire',
            reasoning: `Deadline de contratação (${job.hiring_deadline}) vencido sem preenchimento. Vaga expirada — só um humano pode reabrir.`,
          })
          await logRecruiterEvent(supabase, {
            orgId: job.org_id, unitId: job.unit_id, jobId: job.id,
            eventType: 'job.expired',
            message: `Deadline ${job.hiring_deadline} vencido.`,
          })
          stats.expired += 1
        } catch { stats.errors += 1 }
      }
    }

    // Trabalho que envia mensagem só roda dentro do horário ativo
    if (!isWithinActiveHours(config.active_hours)) continue

    const activeJobs = jobs.filter((job) => !(job.hiring_deadline && job.hiring_deadline < today))

    // ── 2. Vagas draft → iniciar intake
    let intakesStarted = 0
    for (const job of activeJobs.filter((j) => j.status === 'draft')) {
      if (intakesStarted >= MAX_INTAKES_PER_UNIT) break
      if (!job.lead_id) continue
      try {
        const lead = await getLeadForJob(supabase, job)
        if (!lead) continue
        const started = await startIntake(supabase, { job, unit, config, lead })
        if (started) { intakesStarted += 1; stats.intakesStarted += 1 }
      } catch { stats.errors += 1 }
    }

    // ── 3. Intake parado: lembretes 24h/72h, depois stalled (exceção 1)
    for (const job of activeJobs.filter((j) => j.status === 'profiling')) {
      try {
        const { data: convData } = await supabase
          .from('conversations')
          .select('*')
          .eq('lead_id', job.lead_id!)
          .gte('sent_at', job.created_at)
          .order('sent_at', { ascending: false })
          .limit(20)
        const convs = (convData as Conversation[] | null) ?? []
        const lastMessage = convs[0]
        if (!lastMessage || lastMessage.direction === 'inbound') continue // bola está com o agente (webhook responde)

        const silentMs = Date.now() - new Date(lastMessage.sent_at).getTime()
        const remindersSent = convs.filter(
          (c) => c.direction === 'outbound' && c.template_key === 'recruiter_intake_reminder',
        ).length

        if (remindersSent >= 2 && silentMs > 3 * DAY_MS) {
          await supabase
            .from('job_openings')
            .update({ status: 'stalled', previous_status: 'profiling', stalled_since: new Date().toISOString() })
            .eq('id', job.id)
          await logDecision(supabase, {
            orgId: job.org_id, unitId: job.unit_id, jobId: job.id,
            decisionType: 'stalled',
            reasoning: 'Empresa não respondeu o intake após 2 lembretes (24h e 72h). Vaga marcada como parada — alerta visível no dashboard.',
          })
          stats.stalledMarked += 1
          continue
        }

        const shouldRemind =
          (remindersSent === 0 && silentMs > 1 * DAY_MS) || (remindersSent === 1 && silentMs > 3 * DAY_MS)
        if (shouldRemind) {
          const lead = await getLeadForJob(supabase, job)
          if (lead) {
            const ok = await sendIntakeReminder(supabase, { job, unit, config, lead, attempt: remindersSent + 1 })
            if (ok) stats.remindersSent += 1
          }
        }
      } catch { stats.errors += 1 }
    }

    // ── 3b. Stalled há 7+ dias vindo do intake → re-tenta 1x, depois expira
    for (const job of activeJobs.filter((j) => j.status === 'stalled')) {
      try {
        if (!job.stalled_since) continue
        const stalledMs = Date.now() - new Date(job.stalled_since).getTime()
        if (job.previous_status === 'profiling' && stalledMs > 7 * DAY_MS) {
          const lead = await getLeadForJob(supabase, job)
          if (lead && stalledMs < 14 * DAY_MS) {
            // uma última retomada após 7 dias
            const ok = await sendIntakeReminder(supabase, { job, unit, config, lead, attempt: 2 })
            if (ok) {
              await supabase
                .from('job_openings')
                .update({ status: 'profiling', stalled_since: null })
                .eq('id', job.id)
              stats.remindersSent += 1
            }
          } else {
            await supabase.from('job_openings').update({ status: 'expired' }).eq('id', job.id)
            await logDecision(supabase, {
              orgId: job.org_id, unitId: job.unit_id, jobId: job.id,
              decisionType: 'expire',
              reasoning: 'Vaga parada há mais de 14 dias sem resposta da empresa mesmo após retomada. Expirada.',
            })
            stats.expired += 1
          }
        }
      } catch { stats.errors += 1 }
    }

    // ── 4. Sourcing pendente (profile_ready, ou sourcing travado de execução anterior)
    let sourcingRuns = 0
    for (const job of activeJobs.filter((j) => ['profile_ready', 'sourcing'].includes(j.status))) {
      if (sourcingRuns >= MAX_SOURCING_PER_UNIT) break
      try {
        await runSourcing(supabase, { job, unit, config })
        sourcingRuns += 1
        stats.sourcingRuns += 1
      } catch (error) {
        stats.errors += 1
        await logSystemEvent(supabase, {
          level: 'error',
          source: 'recruiter',
          eventType: 'recruiter_sourcing_failed',
          message: `Sourcing da vaga "${job.title}" falhou no cron: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
          orgId: job.org_id, unitId: unit.id,
          metadata: { job_id: job.id },
        })
      }
    }

    // ── 5. Outreach + candidatos silenciosos + shortlist
    for (const job of activeJobs.filter((j) => ['outreach', 'screening', 'sourcing_expanded'].includes(j.status))) {
      try {
        await nudgeSilentCandidates(supabase, { job, unit, config })
        const { sent } = await sendOutreachBatch(supabase, { job, unit, config })
        stats.outreachSent += sent
        await recalculateShortlist(supabase, { job, unit, config })
      } catch { stats.errors += 1 }
    }

    // ── 6. Empresa avaliando a shortlist: follow-ups +2/+5/+9, depois escala
    for (const job of activeJobs.filter((j) => j.status === 'company_review')) {
      try {
        const { data: presentedRows } = await supabase
          .from('job_candidates')
          .select('presented_at, report, ai_score')
          .eq('job_id', job.id)
          .not('presented_at', 'is', null)
          .order('ai_score', { ascending: false, nullsFirst: false })

        const rows = (presentedRows as { presented_at: string; report: { strengths?: string[] } | null; ai_score: number | null }[] | null) ?? []
        const presentedAt = rows[0]?.presented_at
        if (!presentedAt) continue

        const daysSince = (Date.now() - new Date(presentedAt).getTime()) / DAY_MS
        const attempt = job.follow_up_count + 1

        if (job.follow_up_count >= limits.company_followup_max) {
          if (daysSince > FOLLOW_UP_OFFSETS_DAYS[2]! + 3) {
            await escalateJob(supabase, {
              job, unit,
              reason: `Empresa não respondeu a shortlist da vaga "${job.title}" após ${limits.company_followup_max} follow-ups.`,
            })
            stats.escalated += 1
          }
          continue
        }

        const dueDay = FOLLOW_UP_OFFSETS_DAYS[attempt - 1] ?? 9
        if (daysSince < dueDay) continue

        const lead = await getLeadForJob(supabase, job)
        if (!lead) continue

        const { data: prevFollowUps } = await supabase
          .from('conversations')
          .select('content, template_key')
          .eq('lead_id', lead.id)
          .like('template_key', 'recruiter_company_followup_%')
          .order('sent_at', { ascending: true })

        const topFact = rows[0]?.report?.strengths?.[0] ?? null
        const ok = await sendCompanyFollowUp(supabase, {
          job, unit, config, lead, attempt,
          presentedAt: new Date(presentedAt).toLocaleDateString('pt-BR'),
          topCandidateFact: topFact,
          previousFollowUps: ((prevFollowUps as { content: string }[] | null) ?? []).map((r) => r.content),
        })
        if (ok) stats.followUpsSent += 1
      } catch { stats.errors += 1 }
    }

    // ── 7. Manutenção: refresh noturno incremental da base Smarter (1x por org)
    if (unit.org_id && !syncedOrgs.has(unit.org_id) && getSmarterApiConfig()) {
      syncedOrgs.add(unit.org_id)
      try {
        await syncSmarterCandidates(supabase, {
          orgId: unit.org_id,
          unitId: unit.id,
          updatedSince: new Date(Date.now() - DAY_MS).toISOString(),
        })
        await ensureCandidateEmbeddings(supabase, unit.org_id)
      } catch (error) {
        stats.errors += 1
        await logSystemEvent(supabase, {
          level: 'error',
          source: 'recruiter',
          eventType: 'smarter_api_error',
          message: `Refresh noturno da API Smarter falhou: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
          orgId: unit.org_id, unitId: unit.id,
        })
      }
    }
  }

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'cron',
    eventType: 'recruiter_cron_run',
    message: `Cron do Recruiter executado: ${stats.intakesStarted} intakes, ${stats.sourcingRuns} sourcings, ${stats.outreachSent} outreach, ${stats.followUpsSent} follow-ups, ${stats.remindersSent} lembretes, ${stats.expired} expiradas, ${stats.escalated} escaladas, ${stats.errors} erros.`,
    metadata: stats,
  })

  return NextResponse.json({ ok: true, ...stats, units: configRows.length })
}
