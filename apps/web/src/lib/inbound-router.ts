import type { SupabaseClient } from '@supabase/supabase-js'
import { processInboundMessage } from '@/lib/conversation-engine'
import { generateChatReply, generateStructuredReply, getOpenAIApiKey } from '@/lib/openai'
import { getRecruiterConfig } from '@/lib/recruiter/guardrails'
import { handleCandidateInbound } from '@/lib/recruiter/screening-engine'
import { handleCompanyIntakeInbound } from '@/lib/recruiter/intake-engine'
import { handleCompanyReviewInbound, getLeadForJob } from '@/lib/recruiter/orchestrator'
import { buildRecruiterBasePrompt } from '@/lib/recruiter/prompts'
import { sendToCompany } from '@/lib/recruiter/messaging'
import { logDecision } from '@/lib/recruiter/log'
import { handleSalesDealHandoff } from '@/lib/sales/deal-handoff'
import { processReceptionistInbound } from '@/lib/receptionist/engine'
import { logSystemEvent } from '@/lib/system-events'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { getMessagingChannel } from '@/lib/channels/messaging-channel'
import type { ChannelType } from '@/lib/channels/messaging-channel'
import type { Customer, Lead, Unit } from '@/lib/types'
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

function emailsMatch(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase())
}

/**
 * Identifica o remetente de uma mensagem recebida contra um registro
 * (lead/candidato) — por telefone (WhatsApp/SMS) OU por e-mail, o que
 * estiver disponível no canal de entrada. Mantém a cascata de roteamento
 * (§7.0) igual para os três canais: só muda o campo usado pra bater.
 */
function identifierMatches(
  row: { phone: string | null; email: string | null },
  incomingPhone: string | null,
  incomingEmail: string | null,
): boolean {
  if (incomingPhone && phonesMatch(normalizePhone(row.phone), incomingPhone)) return true
  if (incomingEmail && emailsMatch(row.email, incomingEmail)) return true
  return false
}

type CandidateContext = { candidate: Candidate; jc: JobCandidate; job: JobOpening }

/** Rota 1 (§7.0): telefone/e-mail bate com candidato em processo ativo na unidade. */
async function findCandidateContext(
  supabase: SupabaseClient,
  unit: Unit,
  incomingPhone: string | null,
  incomingEmail: string | null,
): Promise<CandidateContext | null> {
  if (!unit.org_id) return null

  const { data: candidatesData } = await supabase
    .from('candidates')
    .select('*')
    .eq('org_id', unit.org_id)

  const candidate = ((candidatesData as Candidate[] | null) ?? []).find((row) =>
    identifierMatches(row, incomingPhone, incomingEmail),
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

/** Rota 2.5 (§7.0): telefone/e-mail bate com um cliente já cadastrado (Receptionist) — dono do relacionamento pós-venda, com prioridade sobre o fluxo genérico de lead (Rota 4) e sobre a triagem de número desconhecido (Rota 3). */
async function findCustomerContext(
  supabase: SupabaseClient,
  unit: Unit,
  incomingPhone: string | null,
  incomingEmail: string | null,
): Promise<Customer | null> {
  if (!unit.org_id) return null

  const { data } = await supabase.from('customers').select('*').eq('unit_id', unit.id)
  return ((data as Customer[] | null) ?? []).find((row) => identifierMatches(row, incomingPhone, incomingEmail)) ?? null
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

type UnknownInboundContext = {
  supabase: SupabaseClient
  unit: Unit
  channel: ChannelType
  incomingPhone: string | null
  incomingEmail: string | null
  text: string
  externalMessageId: string | null
  sentAt: string
  wasAudioMessage?: boolean
}

async function handleUnknownInbound(params: UnknownInboundContext): Promise<void> {
  const { supabase, unit, channel, incomingPhone, incomingEmail, text, externalMessageId, sentAt, wasAudioMessage } = params
  const apiKey = getOpenAIApiKey()
  const messagingChannel = getMessagingChannel(unit, supabase)

  if (!apiKey || !messagingChannel) return

  if (!incomingPhone) {
    // Sem telefone, não conseguimos fazer triagem por chat, apenas registra o evento
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'system',
      eventType: 'unknown_inbound_without_phone',
      message: `Mensagem de número desconhecido recebida mas sem telefone para triagem (e-mail: ${incomingEmail ?? 'vazio'})`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
    return
  }

  // Procura por um lead em triagem (source = 'unknown_inbound' e status = 'contacted')
  // para este número — indica que a pergunta de triagem já foi enviada
  const { data: screeningLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('source', 'unknown_inbound')
    .eq('status', 'contacted')
    .order('created_at', { ascending: false })
    .limit(5)

  type ScreeningLead = Lead & { phone: string | null }
  const existingScreeningLead = ((screeningLeads as ScreeningLead[] | null) ?? []).find(
    (lead) => lead.phone && phonesMatch(normalizePhone(lead.phone), incomingPhone),
  )

  // ── Fase 1: Lead em triagem respondeu ──────────────────────────────
  if (existingScreeningLead) {
    // Interpretar resposta: é candidato ou empresa?
    const screeningInterpretation = await generateStructuredReply<{
      is_candidate_or_employee?: boolean
      is_company?: boolean
      is_existing_customer?: boolean
      reasoning?: string
    }>({
      apiKey,
      systemPrompt: [
        'Você está analisando uma resposta a uma pergunta de triagem sobre o motivo do contato.',
        'A pessoa poderia ser: (1) um estudante/candidato procurando vaga; (2) uma empresa procurando contratar; (3) um cliente ativo procurando outro assunto; (4) algo indeterminado.',
        'Responda com um JSON: {"is_candidate_or_employee": boolean, "is_company": boolean, "is_existing_customer": boolean, "reasoning": string}.',
        'Seja conciso — apenas uma dessas três flags deve ser true. Se indeterminado, todas false.',
      ].join(' '),
      history: [{ role: 'user', content: text }],
      maxTokens: 200,
    }).catch(() => ({ is_candidate_or_employee: false, is_company: false, is_existing_customer: false }))

    // Registra a mensagem de resposta
    await supabase.from('conversations').insert({
      lead_id: existingScreeningLead.id,
      unit_id: unit.id,
      channel,
      direction: 'inbound',
      content: text,
      external_message_id: externalMessageId,
      status: 'delivered',
      sent_at: sentAt,
    })

    // ── Subcaso 1: É candidato/estudante ──────────────────────────────
    if (screeningInterpretation.is_candidate_or_employee) {
      // Atualiza lead para indicar que é candidato (source: 'unknown_inbound_candidate')
      // e volta para 'new' para rotar pelo Sales Rep (que vai encaminhar ao Recruiter se necessário)
      await supabase
        .from('leads')
        .update({
          status: 'new',
          source: 'unknown_inbound_candidate',
          last_contacted_at: sentAt,
        })
        .eq('id', existingScreeningLead.id)

      await logSystemEvent(supabase, {
        level: 'info',
        source: 'system',
        eventType: 'unknown_inbound_identified_candidate',
        message: `Número desconhecido identificado como candidato/estudante via triagem. Lead criado como fonte unknown_inbound_candidate.`,
        orgId: unit.org_id,
        unitId: unit.id,
        leadId: existingScreeningLead.id,
      })
      return
    }

    // ── Subcaso 2: É empresa/cliente procurando contratar ──────────────
    if (screeningInterpretation.is_company) {
      // Atualiza lead para empresa (source: 'unknown_inbound')
      // e status normal para rotar pelo Sales Rep
      await supabase
        .from('leads')
        .update({
          status: 'replied',
          source: 'unknown_inbound',
          last_contacted_at: sentAt,
        })
        .eq('id', existingScreeningLead.id)

      await logSystemEvent(supabase, {
        level: 'info',
        source: 'system',
        eventType: 'unknown_inbound_identified_company',
        message: `Número desconhecido identificado como empresa/cliente procurando contratar via triagem. Lead criado como fonte unknown_inbound.`,
        orgId: unit.org_id,
        unitId: unit.id,
        leadId: existingScreeningLead.id,
      })
      return
    }

    // ── Subcaso 3: Diz que já é cliente ─────────────────────────────
    if (screeningInterpretation.is_existing_customer) {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'system',
        eventType: 'unknown_inbound_claims_existing_customer',
        message: `Número desconhecido diz ser cliente ativo: ${text}. Requer revisão humana — número não bate com nenhum registro.`,
        orgId: unit.org_id,
        unitId: unit.id,
        leadId: existingScreeningLead.id,
      })
      // Marca o lead como "paused" para não entrar em fluxo automático
      await supabase
        .from('leads')
        .update({
          status: 'paused',
          source: 'unknown_inbound_unmatched_customer',
          last_contacted_at: sentAt,
        })
        .eq('id', existingScreeningLead.id)
      return
    }

    // ── Subcaso 4: Indeterminado — pergunta novamente ────────────────
    const followUpQuestion = await generateChatReply({
      apiKey,
      systemPrompt:
        'Você é um assistente de triagem que precisa esclarecer o motivo do contato de forma educada. ' +
        'A pessoa respondeu algo indeterminado. Pergunte de novo, mas de forma ligeiramente diferente, ' +
        'se ela procura uma vaga, quer oferecer oportunidade, ou se já é cliente. Mantenha breve (1-2 frases).',
      history: [{ role: 'user', content: text }],
    })

    if (followUpQuestion) {
      try {
        await messagingChannel.sendMessage(incomingPhone, followUpQuestion, { voiceReply: wasAudioMessage })
        await supabase.from('conversations').insert({
          lead_id: existingScreeningLead.id,
          unit_id: unit.id,
          channel,
          direction: 'outbound',
          content: followUpQuestion,
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
      } catch (error) {
        console.error(`[inbound_router] follow-up triagem falhou: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return
  }

  // ── Fase 2: Primeira mensagem — enviar pergunta de triagem ────────────
  const triageQuestion = await generateChatReply({
    apiKey,
    systemPrompt:
      'Você é um assistente de primeiro contato que recebe mensagens de números desconhecidos. ' +
      'Responda de forma amigável e breve (1-2 frases) perguntando o motivo do contato: ' +
      'se a pessoa procura uma vaga/oportunidade de trabalho, se representa uma empresa que quer contratar, ' +
      'ou se já é cliente. Use linguagem conversacional e natural.',
    history: [{ role: 'user', content: text }],
  })

  if (!triageQuestion) return

  // Criar um lead em status "contacted" (indicando que a pergunta de triagem foi enviada)
  const { data: insertedLead, error } = await supabase
    .from('leads')
    .insert({
      unit_id: unit.id,
      phone: incomingPhone,
      email: incomingEmail,
      company_name: `Contato desconhecido (${incomingPhone.slice(-4)})`,
      contact_name: null,
      source: 'unknown_inbound',
      status: 'contacted',
    })
    .select()
    .single()

  if (error || !insertedLead) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'system',
      eventType: 'unknown_inbound_lead_create_failed',
      message: `Falha ao criar lead de triagem para número desconhecido ${incomingPhone}: ${error?.message ?? 'erro desconhecido'}`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
    return
  }

  const leadRow = insertedLead as Lead

  // Registra a primeira mensagem do cliente
  await supabase.from('conversations').insert({
    lead_id: leadRow.id,
    unit_id: unit.id,
    channel,
    direction: 'inbound',
    content: text,
    external_message_id: externalMessageId,
    status: 'delivered',
    sent_at: sentAt,
  })

  // Envia a pergunta de triagem
  try {
    await messagingChannel.sendMessage(incomingPhone, triageQuestion, { voiceReply: wasAudioMessage })
    await supabase.from('conversations').insert({
      lead_id: leadRow.id,
      unit_id: unit.id,
      channel,
      direction: 'outbound',
      content: triageQuestion,
      status: 'sent',
      sent_at: new Date().toISOString(),
    })
  } catch (error) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'system',
      eventType: 'unknown_inbound_triage_question_failed',
      message: `Falha ao enviar pergunta de triagem para número desconhecido ${incomingPhone}: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      orgId: unit.org_id,
      unitId: unit.id,
      leadId: leadRow.id,
    })
  }
}

export type InboundRouteParams = {
  supabase: SupabaseClient
  unit: Unit
  channel: ChannelType
  /** Telefone de origem (WhatsApp/SMS) — null quando o canal é e-mail. */
  incomingPhone: string | null
  /** E-mail de origem — null quando o canal é telefone. */
  incomingEmail: string | null
  text: string
  externalMessageId: string | null
  sentAt: string
  /** Mensagem recebida era um áudio (nota de voz) — resposta deve espelhar a modalidade (item 1 do pedido de voz). */
  wasAudioMessage?: boolean
}

export async function routeInboundMessage(params: InboundRouteParams): Promise<Record<string, unknown>> {
  const { supabase, unit: unitRow, channel, incomingPhone, incomingEmail, text, externalMessageId, sentAt, wasAudioMessage } = params

  // Contextos possíveis
  const candidateContext = await findCandidateContext(supabase, unitRow, incomingPhone, incomingEmail)

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('unit_id', unitRow.id)

  const lead = ((leads as Lead[] | null) ?? []).find((row) =>
    identifierMatches(row, incomingPhone, incomingEmail),
  )
  const recruiterJob = lead ? await findRecruiterJobForLead(supabase, lead) : null

  // Ambiguidade: mesmo telefone/e-mail é candidato E empresa com processo
  // ativo → prioriza o contexto com atividade mais recente + decision log (§7.0)
  let routeToCandidate = Boolean(candidateContext)
  if (candidateContext && recruiterJob) {
    const candidateActivity = new Date(candidateContext.jc.updated_at).getTime()
    const companyActivity = new Date(recruiterJob.updated_at).getTime()
    routeToCandidate = candidateActivity >= companyActivity
    const identifierLabel = incomingPhone ? `Telefone ${incomingPhone.slice(-8)}` : `E-mail ${incomingEmail}`
    await logDecision(supabase, {
      orgId: unitRow.org_id,
      unitId: unitRow.id,
      jobId: routeToCandidate ? candidateContext.job.id : recruiterJob.id,
      candidateId: candidateContext.candidate.id,
      decisionType: 'route_ambiguous',
      reasoning: `${identifierLabel} corresponde a candidato e a empresa com processos ativos. Roteado para o contexto com atividade mais recente (${routeToCandidate ? 'candidato' : 'empresa'}).`,
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
      wasAudioMessage,
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
      await handleCompanyIntakeInbound(supabase, { job: recruiterJob, unit: unitRow, config, lead, text, wasAudioMessage })
    } else if (['company_review', 'presented', 'shortlist_ready'].includes(recruiterJob.status)) {
      await handleCompanyReviewInbound(supabase, { job: recruiterJob, unit: unitRow, config, lead, text, wasAudioMessage })
    } else {
      // Vaga em sourcing/outreach/screening: resposta de status honesta
      const apiKey = getOpenAIApiKey()
      if (apiKey) {
        const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unitRow.org_id)
        const reply = await generateChatReply({
          apiKey,
          systemPrompt: [
            buildRecruiterBasePrompt(config, unitRow, organizationProfile),
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

  // ── Rota 2.5: cliente cadastrado (Receptionist) ─────────────────────
  // Só é alcançada quando as Rotas 1 e 2 não bateram (ambas retornam
  // sempre que o if delas é verdadeiro) — um cliente que também é
  // candidato/empresa com processo ativo no Recrutador continua
  // priorizando esse processo, igual ao comportamento de antes desta
  // rota existir.
  const customer = await findCustomerContext(supabase, unitRow, incomingPhone, incomingEmail)
  if (customer) {
    await supabase.from('customer_messages').insert({
      customer_id: customer.id,
      unit_id: unitRow.id,
      channel,
      direction: 'inbound',
      content: text,
      external_message_id: externalMessageId,
      status: 'delivered',
      sent_at: sentAt,
    })

    const recipient = incomingPhone ?? incomingEmail
    if (!recipient) return { ok: true, routed: 'receptionist', skipped: 'no_recipient' }

    const result = await processReceptionistInbound({
      supabase,
      unit: unitRow,
      customer,
      incomingText: text,
      channel,
      recipient,
      wasAudioMessage,
    })
    return { ok: true, routed: 'receptionist', handled: result.handled }
  }

  // ── Rota 3: número desconhecido ou em triagem ──────────────────────
  // (triagem: lead com source='unknown_inbound' e status='contacted')
  if (!lead || (lead.source === 'unknown_inbound' && lead.status === 'contacted')) {
    await handleUnknownInbound({
      supabase,
      unit: unitRow,
      channel,
      incomingPhone,
      incomingEmail,
      text,
      externalMessageId,
      sentAt,
      wasAudioMessage,
    })
    return { ok: true, routed: 'unknown_inbound_screening' }
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

  const result = await processInboundMessage({
    supabase,
    unit: unitRow,
    lead: updatedLead,
    incomingText: text,
    wasAudioMessage,
  })

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
