import type { SupabaseClient } from '@supabase/supabase-js'
import { processInboundMessage } from '@/lib/conversation-engine'
import { generateChatReply, getOpenAIApiKey } from '@/lib/openai'
import { getRecruiterConfig } from '@/lib/recruiter/guardrails'
import { handleCandidateInbound } from '@/lib/recruiter/screening-engine'
import { handleCompanyIntakeInbound } from '@/lib/recruiter/intake-engine'
import { handleCompanyReviewInbound, getLeadForJob } from '@/lib/recruiter/orchestrator'
import { buildRecruiterBasePrompt } from '@/lib/recruiter/prompts'
import { sendToCompany } from '@/lib/recruiter/messaging'
import { logDecision } from '@/lib/recruiter/log'
import { handleSalesDealHandoff } from '@/lib/sales/deal-handoff'
import { logSystemEvent } from '@/lib/system-events'
import type { ChannelType } from '@/lib/channels/messaging-channel'
import type { Lead, Unit } from '@/lib/types'
import type { Candidate, JobCandidate, JobOpening } from '@/lib/recruiter/types'

// Roteamento em cascata (§7.0) da mensagem recebida, compartilhado entre
// todos os canais (WhatsApp via app/api/webhooks/whatsapp, SMS via
// app/api/webhooks/sms). O funcionário de IA não tem lógica duplicada
// por canal — só o transporte (como a mensagem chega e como a resposta é
// enviada) muda entre os webhooks; a decisão de "pra quem/o que
// responder" é sempre esta função.

export function normalizePhone(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

export function phonesMatch(a: string, b: string): boolean {
  return a.length > 0 && b.length > 0 && (a.endsWith(b.slice(-8)) || b.endsWith(a.slice(-8)))
}

type CandidateContext = { candidate: Candidate; jc: JobCandidate; job: JobOpening }

/** Rota 1 (§7.0): telefone bate com candidato em processo ativo na unidade. */
async function findCandidateContext(
  supabase: SupabaseClient,
  unit: Unit,
  incomingPhone: string,
): Promise<CandidateContext | null> {
  if (!unit.org_id) return null

  const { data: candidatesData } = await supabase
    .from('candidates')
    .select('*')
    .eq('org_id', unit.org_id)
    .not('phone', 'is', null)

  const candidate = ((candidatesData as Candidate[] | null) ?? []).find((row) =>
    phonesMatch(normalizePhone(row.phone), incomingPhone),
  )
  if (!candidate) return null

  const { data: jcData } = await supabase
    .from('job_candidates')
    .select('*, job_openings(*)')
    .eq('candidate_id', candidate.id)
    .eq('unit_id', unit.id)
    .in('stage', ['contacted', 'in_screening'])
    .order('updated_at', { ascending: false })
    .limit(1)

  type Row = JobCandidate & { job_openings: JobOpening | null }
  const row = ((jcData as Row[] | null) ?? [])[0]
  if (!row?.job_openings) return null
  const { job_openings: job, ...jc } = row
  return { candidate, jc: jc as JobCandidate, job }
}

/** Rota 2 (§7.0): telefone bate com lead que tem vaga ativa com o Recruiter. */
async function findRecruiterJobForLead(
  supabase: SupabaseClient,
  lead: Lead,
): Promise<JobOpening | null> {
  const { data } = await supabase
    .from('job_openings')
    .select('*')
    .eq('lead_id', lead.id)
    .in('status', ['profiling', 'profile_ready', 'sourcing', 'sourcing_expanded', 'outreach', 'screening', 'shortlist_ready', 'presented', 'company_review'])
    .order('updated_at', { ascending: false })
    .limit(1)

  return ((data as JobOpening[] | null) ?? [])[0] ?? null
}

export type InboundRouteParams = {
  supabase: SupabaseClient
  unit: Unit
  channel: ChannelType
  incomingPhone: string
  text: string
  externalMessageId: string | null
  sentAt: string
}

export async function routeInboundMessage(params: InboundRouteParams): Promise<Record<string, unknown>> {
  const { supabase, unit: unitRow, channel, incomingPhone, text, externalMessageId, sentAt } = params

  // Contextos possíveis
  const candidateContext = await findCandidateContext(supabase, unitRow, incomingPhone)

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('unit_id', unitRow.id)
    .not('phone', 'is', null)

  const lead = ((leads as Lead[] | null) ?? []).find((row) =>
    phonesMatch(normalizePhone(row.phone), incomingPhone),
  )
  const recruiterJob = lead ? await findRecruiterJobForLead(supabase, lead) : null

  // Ambiguidade: mesmo telefone é candidato E empresa com processo ativo →
  // prioriza o contexto com atividade mais recente + decision log (§7.0)
  let routeToCandidate = Boolean(candidateContext)
  if (candidateContext && recruiterJob) {
    const candidateActivity = new Date(candidateContext.jc.updated_at).getTime()
    const companyActivity = new Date(recruiterJob.updated_at).getTime()
    routeToCandidate = candidateActivity >= companyActivity
    await logDecision(supabase, {
      orgId: unitRow.org_id,
      unitId: unitRow.id,
      jobId: routeToCandidate ? candidateContext.job.id : recruiterJob.id,
      candidateId: candidateContext.candidate.id,
      decisionType: 'route_ambiguous',
      reasoning: `Telefone ${incomingPhone.slice(-8)} corresponde a candidato e a empresa com processos ativos. Roteado para o contexto com atividade mais recente (${routeToCandidate ? 'candidato' : 'empresa'}).`,
    })
  }

  // ── Rota 1: candidato em triagem ──────────────────────────────────
  if (candidateContext && routeToCandidate) {
    const { candidate, jc, job } = candidateContext

    await supabase.from('candidate_messages').insert({
      candidate_id: candidate.id,
      job_id: job.id,
      unit_id: unitRow.id,
      channel,
      direction: 'inbound',
      content: text,
      external_message_id: externalMessageId,
      status: 'delivered',
      sent_at: sentAt,
    })

    const config = await getRecruiterConfig(supabase, unitRow.id)
    if (!config || !config.is_active) {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'recruiter',
        eventType: 'recruiter_not_configured',
        message: `Candidato respondeu na unidade "${unitRow.name}" mas o agente Recruiter está ${config ? 'inativo' : 'sem configuração'} — nenhuma resposta enviada.`,
        orgId: unitRow.org_id,
        unitId: unitRow.id,
      })
      return { ok: true, routed: 'recruiter_candidate', skipped: 'agent_not_configured' }
    }

    const jobLead = await getLeadForJob(supabase, job)
    await handleCandidateInbound(supabase, {
      job, jc, candidate,
      unit: unitRow, config,
      lead: jobLead,
      text,
    })
    return { ok: true, routed: 'recruiter_candidate' }
  }

  // ── Rota 2: empresa com vaga ativa no Recruiter ───────────────────
  if (lead && recruiterJob) {
    await supabase.from('conversations').insert({
      lead_id: lead.id,
      unit_id: unitRow.id,
      channel,
      direction: 'inbound',
      content: text,
      external_message_id: externalMessageId,
      status: 'delivered',
      sent_at: sentAt,
    })
    await supabase.from('leads').update({ last_contacted_at: sentAt }).eq('id', lead.id)

    const config = await getRecruiterConfig(supabase, unitRow.id)
    if (!config || !config.is_active) {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'recruiter',
        eventType: 'recruiter_not_configured',
        message: `Empresa respondeu sobre a vaga "${recruiterJob.title}" mas o agente Recruiter está ${config ? 'inativo' : 'sem configuração'}.`,
        orgId: unitRow.org_id,
        unitId: unitRow.id,
        leadId: lead.id,
      })
      return { ok: true, routed: 'recruiter_company', skipped: 'agent_not_configured' }
    }

    if (recruiterJob.status === 'profiling' || recruiterJob.profile.awaiting_confirmation) {
      await handleCompanyIntakeInbound(supabase, { job: recruiterJob, unit: unitRow, config, lead, text })
    } else if (['company_review', 'presented', 'shortlist_ready'].includes(recruiterJob.status)) {
      await handleCompanyReviewInbound(supabase, { job: recruiterJob, unit: unitRow, config, lead, text })
    } else {
      // Vaga em sourcing/outreach/screening: resposta de status honesta
      const apiKey = getOpenAIApiKey()
      if (apiKey) {
        const reply = await generateChatReply({
          apiKey,
          systemPrompt: [
            buildRecruiterBasePrompt(config, unitRow),
            `A empresa mandou mensagem sobre a vaga "${recruiterJob.title}", que está na etapa "${recruiterJob.status}" (busca/triagem de candidatos em andamento).`,
            'Responda a mensagem dela com base nisso: dê um status honesto e curto do processo e diga que volta com a shortlist em breve. Não invente números nem prazos exatos.',
          ].join(' '),
          history: [{ role: 'user', content: text }],
        })
        if (reply) {
          await sendToCompany({
            supabase, unit: unitRow, config,
            leadId: lead.id, leadPhone: lead.phone, leadEmail: lead.email,
            text: reply, templateKey: 'recruiter_status_reply', skipRateLimits: true,
          })
        }
      }
    }
    return { ok: true, routed: 'recruiter_company' }
  }

  // ── Rota 3: fluxo SDR/Sales Rep original, intocado ────────────────
  if (!lead) {
    return { ok: true, skipped: 'lead_not_found' }
  }

  await supabase.from('conversations').insert({
    lead_id: lead.id,
    unit_id: unitRow.id,
    channel,
    direction: 'inbound',
    content: text,
    external_message_id: externalMessageId,
    status: 'delivered',
    sent_at: sentAt,
  })

  const updatedLead: Lead = {
    ...lead,
    status: lead.status === 'new' ? 'replied' : lead.status,
    last_contacted_at: sentAt,
  }

  await supabase
    .from('leads')
    .update({ status: updatedLead.status, last_contacted_at: sentAt })
    .eq('id', lead.id)

  const result = await processInboundMessage({ supabase, unit: unitRow, lead: updatedLead, incomingText: text })

  if (result.dealHandoffReady) {
    try {
      await handleSalesDealHandoff(supabase, { leadId: lead.id, unit: unitRow })
    } catch (error) {
      console.error(
        `[inbound_router] handoff Sales→Recrutador falhou: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return { ok: true, dealHandoffReady: result.dealHandoffReady }
}
