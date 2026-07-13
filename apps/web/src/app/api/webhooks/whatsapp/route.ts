import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { processInboundMessage } from '@/lib/conversation-engine'
import { generateChatReply, getOpenAIApiKey } from '@/lib/openai'
import { getRecruiterConfig } from '@/lib/recruiter/guardrails'
import { handleCandidateInbound } from '@/lib/recruiter/screening-engine'
import { handleCompanyIntakeInbound } from '@/lib/recruiter/intake-engine'
import { handleCompanyReviewInbound, getLeadForJob } from '@/lib/recruiter/orchestrator'
import { buildRecruiterBasePrompt } from '@/lib/recruiter/prompts'
import { sendToCompany } from '@/lib/recruiter/messaging'
import { logDecision } from '@/lib/recruiter/log'
import { logSystemEvent } from '@/lib/system-events'
import type { Lead, Unit } from '@/lib/types'
import type { Candidate, JobCandidate, JobOpening } from '@/lib/recruiter/types'

export const maxDuration = 60

function normalizePhone(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '')
}

function phonesMatch(a: string, b: string): boolean {
  return a.length > 0 && b.length > 0 && (a.endsWith(b.slice(-8)) || b.endsWith(a.slice(-8)))
}

function extractMessageText(message: Record<string, unknown> | undefined): string | null {
  if (!message) return null
  if (typeof message.conversation === 'string') return message.conversation
  const extended = message.extendedTextMessage as { text?: string } | undefined
  if (extended?.text) return extended.text
  const image = message.imageMessage as { caption?: string } | undefined
  if (image?.caption) return image.caption
  return null
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

export async function POST(request: Request) {
  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const instanceName: string | undefined = body.instance
  const data = body.data ?? {}
  const key = data.key ?? {}

  // Ignora mensagens enviadas pela própria unidade (eco do envio outbound)
  if (!instanceName || key.fromMe) {
    return NextResponse.json({ ok: true })
  }

  const text = extractMessageText(data.message)
  if (!text) {
    return NextResponse.json({ ok: true })
  }

  const { data: unit } = await supabase
    .from('units')
    .select('*')
    .eq('evolution_instance_name', instanceName)
    .maybeSingle()

  if (!unit) {
    console.error(
      `[webhook_whatsapp] mensagem recebida para instância "${instanceName}" mas nenhuma unidade corresponde a ela — verifique units.evolution_instance_name.`,
    )
    return NextResponse.json({ error: 'Unidade não encontrada para esta instância.' }, { status: 404 })
  }

  const unitRow = unit as Unit
  const remoteJid: string = key.remoteJid ?? ''
  const incomingPhone = normalizePhone(remoteJid.split('@')[0])

  const sentAt = data.messageTimestamp
    ? new Date(Number(data.messageTimestamp) * 1000).toISOString()
    : new Date().toISOString()

  // ── Roteamento em cascata (§7.0) ──────────────────────────────────

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
      channel: 'whatsapp',
      direction: 'inbound',
      content: text,
      external_message_id: key.id ?? null,
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
      return NextResponse.json({ ok: true, routed: 'recruiter_candidate', skipped: 'agent_not_configured' })
    }

    const jobLead = await getLeadForJob(supabase, job)
    await handleCandidateInbound(supabase, {
      job, jc, candidate,
      unit: unitRow, config,
      lead: jobLead,
      text,
    })
    return NextResponse.json({ ok: true, routed: 'recruiter_candidate' })
  }

  // ── Rota 2: empresa com vaga ativa no Recruiter ───────────────────
  if (lead && recruiterJob) {
    await supabase.from('conversations').insert({
      lead_id: lead.id,
      unit_id: unitRow.id,
      channel: 'whatsapp',
      direction: 'inbound',
      content: text,
      external_message_id: key.id ?? null,
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
      return NextResponse.json({ ok: true, routed: 'recruiter_company', skipped: 'agent_not_configured' })
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
    return NextResponse.json({ ok: true, routed: 'recruiter_company' })
  }

  // ── Rota 3: fluxo SDR original, intocado ──────────────────────────
  if (!lead) {
    return NextResponse.json({ ok: true, skipped: 'lead_not_found' })
  }

  await supabase.from('conversations').insert({
    lead_id: lead.id,
    unit_id: unitRow.id,
    channel: 'whatsapp',
    direction: 'inbound',
    content: text,
    external_message_id: key.id ?? null,
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

  await processInboundMessage({ supabase, unit: unitRow, lead: updatedLead, incomingText: text })

  return NextResponse.json({ ok: true })
}
