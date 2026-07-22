import type { SupabaseClient } from '@supabase/supabase-js'
import { generateChatReply, generateStructuredReply, getOpenAIApiKey, type ChatMessage } from '@/lib/openai'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import type { AgentConfig, Conversation, Lead, Unit } from '@/lib/types'
import {
  buildCompanyIntakePrompt,
  buildConfirmationClassifierPrompt,
  buildProfileExtractorPrompt,
  buildProfileSynthesizerPrompt,
  missingFieldLabels,
} from './prompts'
import { sendToCompany } from './messaging'
import { logDecision, logRecruiterEvent } from './log'
import { runSourcing } from './sourcing-engine'
import { PROFILE_FIELDS, type JobOpening, type JobProfile } from './types'

// Intake & Profiling Engine (§7.2): entrevista conduzida com a empresa
// via WhatsApp (fallback e-mail) para levantar o perfil ideal da vaga.
// Cada resposta passa pelo extractor (JSON mode) que preenche
// job_openings.profile e reduz profile_missing_fields; ao completar,
// o sintetizador gera o perfil ideal e pede confirmação à empresa.
// As conversas de intake vivem em `conversations` (a empresa É um lead),
// com template_key prefixado recruiter_*.

export function computeMissingFields(profile: JobProfile): string[] {
  return PROFILE_FIELDS.filter(({ key }) => {
    const value = profile[key]
    if (value === null || value === undefined) return true
    if (typeof value === 'string') return value.trim().length === 0
    if (Array.isArray(value)) return value.length === 0
    return false
  }).map(({ key }) => key as string)
}

/** Histórico da conversa com a empresa desde a criação da vaga. */
async function getCompanyHistory(
  supabase: SupabaseClient,
  leadId: string,
  since: string,
): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('lead_id', leadId)
    .gte('sent_at', since)
    .order('sent_at', { ascending: true })
    .limit(20)

  return (((data as Conversation[] | null) ?? []) as Conversation[]).map((row) => ({
    role: row.direction === 'inbound' ? 'user' : 'assistant',
    content: row.content,
  }))
}

/** Abre a conversa de levantamento de perfil com a empresa. */
export async function startIntake(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; config: AgentConfig; lead: Lead },
): Promise<boolean> {
  const { job, unit, config, lead } = params
  const apiKey = getOpenAIApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não está configurada.')

  const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unit.org_id)
  const missing = computeMissingFields(job.profile)
  const systemPrompt = [
    buildCompanyIntakePrompt(config, unit, job, missingFieldLabels(missing), organizationProfile),
    `Escreva a PRIMEIRA mensagem para ${lead.contact_name ?? `a empresa ${lead.company_name}`}: parabenize pela abertura da vaga "${job.title}", apresente-se como assistente digital de recrutamento e faça as 2 primeiras perguntas do levantamento.`,
  ].join(' ')

  const text = await generateChatReply({
    apiKey,
    systemPrompt,
    history: [{ role: 'user', content: 'Inicie o levantamento de perfil desta vaga.' }],
  })
  if (!text) return false

  const outcome = await sendToCompany({
    supabase,
    unit,
    config,
    leadId: lead.id,
    leadPhone: lead.phone,
    leadEmail: lead.email,
    text,
    templateKey: 'recruiter_intake_start',
  })

  if (!outcome.sent) return false

  await supabase
    .from('job_openings')
    .update({ status: 'profiling', profile_missing_fields: missing, stalled_since: null })
    .eq('id', job.id)

  await logRecruiterEvent(supabase, {
    orgId: job.org_id,
    unitId: job.unit_id,
    jobId: job.id,
    eventType: 'job.profiling_started',
    message: `Intake iniciado com ${lead.company_name} via ${outcome.channel}.`,
  })

  return true
}

type ExtractedProfile = JobProfile & { low_confidence_fields?: string[] }

/** Funde o resultado do extractor no perfil atual (arrays/valores novos vencem). */
function mergeProfile(current: JobProfile, extracted: ExtractedProfile): JobProfile {
  const merged: JobProfile = { ...current }
  for (const { key } of PROFILE_FIELDS) {
    const value = extracted[key]
    if (value === null || value === undefined) continue
    if (typeof value === 'string' && value.trim().length === 0) continue
    if (Array.isArray(value) && value.length === 0) continue
    ;(merged as Record<string, unknown>)[key] = value
  }
  if (extracted.urgency_notes) merged.urgency_notes = extracted.urgency_notes
  const lowConfidence = new Set([...(current.low_confidence_fields ?? []), ...(extracted.low_confidence_fields ?? [])])
  merged.low_confidence_fields = [...lowConfidence]
  return merged
}

/**
 * Processa uma resposta da empresa durante o profiling: extrai campos,
 * atualiza o perfil e decide o próximo passo (perguntar mais, pedir
 * confirmação do perfil ideal, ou disparar o sourcing).
 */
export async function handleCompanyIntakeInbound(
  supabase: SupabaseClient,
  params: {
    job: JobOpening
    unit: Unit
    config: AgentConfig
    lead: Lead
    text: string
    /** empresa mandou a mensagem por áudio → resposta também deve ser em áudio (mesma mecânica do Sales Rep) */
    wasAudioMessage?: boolean
  },
): Promise<void> {
  const { job, unit, config, lead, text, wasAudioMessage } = params
  const apiKey = getOpenAIApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não está configurada.')

  const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unit.org_id)
  const history = await getCompanyHistory(supabase, lead.id, job.created_at)

  // Perfil completo aguardando "ok" da empresa?
  if (job.profile.awaiting_confirmation) {
    const classification = await generateStructuredReply<{ intent?: string; detail?: string }>({
      apiKey,
      systemPrompt: buildConfirmationClassifierPrompt(),
      history: [{ role: 'user', content: text }],
    })

    if (classification.intent === 'confirmed') {
      const confirmedProfile = { ...job.profile, awaiting_confirmation: false }
      await supabase
        .from('job_openings')
        .update({ status: 'profile_ready', profile: confirmedProfile })
        .eq('id', job.id)

      await logRecruiterEvent(supabase, {
        orgId: job.org_id,
        unitId: job.unit_id,
        jobId: job.id,
        eventType: 'job.profile_completed',
        message: 'Perfil ideal confirmado pela empresa. Sourcing iniciado.',
      })

      const reply = await generateChatReply({
        apiKey,
        systemPrompt: [
          buildCompanyIntakePrompt(config, unit, job, [], organizationProfile),
          'A empresa acabou de confirmar o perfil ideal. Agradeça e avise que você já vai começar a busca dos candidatos e volta em breve com novidades.',
        ].join(' '),
        history: [...history, { role: 'user', content: text }],
      })
      if (reply) {
        await sendToCompany({
          supabase,
          unit,
          config,
          leadId: lead.id,
          leadPhone: lead.phone,
          leadEmail: lead.email,
          text: reply,
          templateKey: 'recruiter_intake_confirmed',
          skipRateLimits: true,
          voiceReply: wasAudioMessage,
        })
      }

      // Dispara o sourcing na mesma request (best-effort);
      // o cron de reconciliação reprocessa vagas profile_ready se falhar.
      try {
        const freshJob = { ...job, profile: confirmedProfile, status: 'profile_ready' as const }
        await runSourcing(supabase, { job: freshJob, unit, config })
      } catch (error) {
        console.error(
          `[recruiter_intake] sourcing inline falhou (cron vai reprocessar): ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      return
    }

    // Empresa quer ajustar: reabre a coleta com o ajuste extraído
    await logDecision(supabase, {
      orgId: job.org_id,
      unitId: job.unit_id,
      jobId: job.id,
      decisionType: 'resume',
      reasoning: `Empresa pediu ajuste no perfil ideal antes de confirmar: ${classification.detail ?? text.slice(0, 120)}`,
    })
  }

  // Extrai o que a resposta preenche
  const extracted = await generateStructuredReply<ExtractedProfile>({
    apiKey,
    systemPrompt: buildProfileExtractorPrompt(job.profile),
    history: [{ role: 'user', content: text }],
  })

  const previousMissing = job.profile_missing_fields ?? []
  const mergedProfile = mergeProfile({ ...job.profile, awaiting_confirmation: false }, extracted)
  let missing = computeMissingFields(mergedProfile)

  // Regra §7.2: máx. 1 re-pergunta sem progresso. Se dois turnos seguidos
  // não preencherem nada novo, os campos restantes viram "confiança baixa"
  // (a triagem valida depois) e o intake avança para a síntese — o
  // processo nunca fica preso num campo que a empresa não sabe responder.
  const progressed = previousMissing.length === 0 || missing.length < previousMissing.length
  mergedProfile.intake_no_progress_count =
    progressed || missing.length === 0 ? 0 : (job.profile.intake_no_progress_count ?? 0) + 1

  if (missing.length > 0 && (mergedProfile.intake_no_progress_count ?? 0) >= 2) {
    mergedProfile.low_confidence_fields = [
      ...new Set([...(mergedProfile.low_confidence_fields ?? []), ...missing]),
    ]
    await logDecision(supabase, {
      orgId: job.org_id,
      unitId: job.unit_id,
      jobId: job.id,
      decisionType: 'resume',
      reasoning: `Campos do perfil sem resposta clara após re-pergunta (${missing.join(', ')}) marcados como confiança baixa — seguindo para a síntese; a triagem valida esses pontos com os candidatos.`,
    })
    missing = []
  }

  if (missing.length === 0) {
    // Perfil completo → sintetiza e pede confirmação
    const synthesis = await generateStructuredReply<{
      summary?: string
      must_haves?: string[]
      nice_to_haves?: string[]
    }>({
      apiKey,
      systemPrompt: buildProfileSynthesizerPrompt({ ...job, profile: mergedProfile }),
      history: [{ role: 'user', content: 'Sintetize o perfil ideal.' }],
    })

    const profileWithSummary: JobProfile = {
      ...mergedProfile,
      ideal_profile_summary: synthesis.summary ?? null,
      awaiting_confirmation: true,
    }

    await supabase
      .from('job_openings')
      .update({ profile: profileWithSummary, profile_missing_fields: [] })
      .eq('id', job.id)

    const confirmText = await generateChatReply({
      apiKey,
      systemPrompt: [
        buildCompanyIntakePrompt(config, unit, { ...job, profile: profileWithSummary }, [], organizationProfile),
        `Todos os dados foram coletados. Apresente este resumo do perfil ideal para a empresa confirmar: "${synthesis.summary ?? ''}". Termine perguntando se é isso mesmo ou se algo precisa de ajuste.`,
      ].join(' '),
      history: [...history, { role: 'user', content: text }],
    })

    if (confirmText) {
      await sendToCompany({
        supabase,
        unit,
        config,
        leadId: lead.id,
        leadPhone: lead.phone,
        leadEmail: lead.email,
        text: confirmText,
        templateKey: 'recruiter_intake_confirm_profile',
        skipRateLimits: true,
        voiceReply: wasAudioMessage,
      })
    }
    return
  }

  // Ainda faltam campos → atualiza e faz as próximas perguntas
  await supabase
    .from('job_openings')
    .update({ profile: mergedProfile, profile_missing_fields: missing })
    .eq('id', job.id)

  const nextQuestion = await generateChatReply({
    apiKey,
    systemPrompt: buildCompanyIntakePrompt(
      config,
      unit,
      { ...job, profile: mergedProfile },
      missingFieldLabels(missing),
      organizationProfile,
    ),
    history: [...history, { role: 'user', content: text }],
  })

  if (nextQuestion) {
    await sendToCompany({
      supabase,
      unit,
      config,
      leadId: lead.id,
      leadPhone: lead.phone,
      leadEmail: lead.email,
      text: nextQuestion,
      templateKey: 'recruiter_intake_question',
      skipRateLimits: true,
      voiceReply: wasAudioMessage,
    })
  }
}

/**
 * Lembrete quando a empresa some no meio do intake (exceção 1 da spec):
 * 2 lembretes (24h/72h); depois a vaga vai para stalled via cron.
 */
export async function sendIntakeReminder(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; config: AgentConfig; lead: Lead; attempt: number },
): Promise<boolean> {
  const { job, unit, config, lead, attempt } = params
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return false

  const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unit.org_id)
  const history = await getCompanyHistory(supabase, lead.id, job.created_at)
  const text = await generateChatReply({
    apiKey,
    systemPrompt: [
      buildCompanyIntakePrompt(config, unit, job, missingFieldLabels(job.profile_missing_fields), organizationProfile),
      `A empresa parou de responder no meio do levantamento (lembrete ${attempt} de 2). Escreva uma retomada leve e útil: relembre em uma frase onde a conversa parou e repita a pergunta pendente de forma ainda mais fácil de responder.`,
    ].join(' '),
    history,
  })
  if (!text) return false

  const outcome = await sendToCompany({
    supabase,
    unit,
    config,
    leadId: lead.id,
    leadPhone: lead.phone,
    leadEmail: lead.email,
    text,
    templateKey: 'recruiter_intake_reminder',
  })

  if (outcome.sent) {
    await logDecision(supabase, {
      orgId: job.org_id,
      unitId: job.unit_id,
      jobId: job.id,
      decisionType: 'follow_up',
      reasoning: `Empresa sem responder o intake — lembrete ${attempt}/2 enviado.`,
    })
  }
  return outcome.sent
}
