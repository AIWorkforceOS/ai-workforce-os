import type { SupabaseClient } from '@supabase/supabase-js'
import { generateChatReply, generateStructuredReply, getOpenAIApiKey, type ChatMessage } from '@/lib/openai'
import type { AgentConfig, Lead, Unit } from '@/lib/types'
import {
  buildOutreachPrompt,
  buildScreeningEvaluatorPrompt,
  buildScreeningExtractorPrompt,
  buildScreeningPrompt,
} from './prompts'
import { detectsNegotiationRequest, detectsOptOut, getRecruiterLimits } from './guardrails'
import { sendToCandidate } from './messaging'
import { logDecision, logRecruiterEvent } from './log'
import { computeWeightedScore } from './scoring-engine'
import { recalculateShortlist, escalateJob, getLeadForJob } from './orchestrator'
import type {
  Candidate,
  CandidateMessage,
  CandidateReport,
  JobCandidate,
  JobOpening,
  ScoreDimension,
  ScreeningData,
} from './types'

// Screening Engine (§7.5): outreach personalizado por candidato e
// triagem conversacional com checklist estruturado — não perguntas
// soltas. Ao final, o avaliador gera ai_score + relatório honesto.

const SCREENING_TOPICS: { key: keyof ScreeningData; label: string }[] = [
  { key: 'interested', label: 'interesse real na vaga' },
  { key: 'availability', label: 'disponibilidade de horário' },
  { key: 'salary_expectation', label: 'expectativa de bolsa/remuneração' },
  { key: 'start_availability', label: 'quando pode começar' },
  { key: 'enrollment_confirmed', label: 'matrícula ativa (declarada, sem coletar documentos)' },
]

function pendingScreeningTopics(data: ScreeningData): string[] {
  return SCREENING_TOPICS.filter(({ key }) => data[key] === null || data[key] === undefined).map(
    ({ label }) => label,
  )
}

function relevantSkills(candidate: Candidate, job: JobOpening): string[] {
  const wanted = [...(job.profile.hard_skills ?? []), ...(job.profile.tools ?? [])].map((s) => s.toLowerCase())
  return (candidate.skills ?? []).filter((skill) =>
    wanted.some((w) => skill.toLowerCase().includes(w) || w.includes(skill.toLowerCase())),
  )
}

async function getCandidateHistory(
  supabase: SupabaseClient,
  candidateId: string,
  jobId: string,
): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('candidate_messages')
    .select('*')
    .eq('candidate_id', candidateId)
    .eq('job_id', jobId)
    .order('sent_at', { ascending: true })
    .limit(20)

  return (((data as CandidateMessage[] | null) ?? []) as CandidateMessage[]).map((row) => ({
    role: row.direction === 'inbound' ? 'user' : 'assistant',
    content: row.content,
  }))
}

/**
 * Envia o outreach para o próximo lote de candidatos ranqueados
 * (por rank, lotes de ~8 — §7.5), respeitando todos os guard-rails.
 */
export async function sendOutreachBatch(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; config: AgentConfig },
): Promise<{ sent: number; skipped: number }> {
  const { job, unit, config } = params
  const apiKey = getOpenAIApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não está configurada.')

  const limits = getRecruiterLimits(config)
  const lead = await getLeadForJob(supabase, job)
  const companyName = lead?.company_name ?? unit.name

  const { data } = await supabase
    .from('job_candidates')
    .select('*, candidates(*)')
    .eq('job_id', job.id)
    .eq('stage', 'ranked')
    .order('rank', { ascending: true })
    .limit(limits.outreach_batch_size)

  type Row = JobCandidate & { candidates: Candidate | null }
  const rows = (((data as Row[] | null) ?? []) as Row[]).filter((row) => row.candidates)

  let sent = 0
  let skipped = 0

  for (const row of rows) {
    const candidate = row.candidates as Candidate

    const text = await generateChatReply({
      apiKey,
      systemPrompt: buildOutreachPrompt({
        config,
        unit,
        job,
        companyName,
        candidateFirstName: candidate.name.split(' ')[0] ?? candidate.name,
        candidateCourse: candidate.course,
        candidateInstitution: candidate.institution,
        candidateSemester: candidate.semester,
        relevantSkills: relevantSkills(candidate, job),
      }),
      history: [{ role: 'user', content: 'Gere a mensagem de primeiro contato.' }],
    })

    const outcome = text
      ? await sendToCandidate({
          supabase, unit, config, candidate,
          jobId: job.id,
          text,
          templateKey: 'recruiter_outreach_1',
        })
      : ({ sent: false, reason: 'falha ao gerar mensagem' } as const)

    if (outcome.sent) {
      sent += 1
      await supabase
        .from('job_candidates')
        .update({
          stage: 'contacted',
          contacted_at: new Date().toISOString(),
          outreach_attempts: 1,
          stage_reason: `contatado via ${outcome.channel}`,
        })
        .eq('id', row.id)
      await logRecruiterEvent(supabase, {
        orgId: job.org_id, unitId: job.unit_id, jobId: job.id, candidateId: candidate.id,
        eventType: 'candidate.contacted',
        message: `Outreach enviado via ${outcome.channel} (rank ${row.rank}, match ${row.match_score}).`,
      })
      await logDecision(supabase, {
        orgId: job.org_id, unitId: job.unit_id, jobId: job.id, candidateId: candidate.id,
        decisionType: 'contact_candidate',
        reasoning: `Candidato no topo do ranking (posição ${row.rank}, match ${row.match_score}) e dentro dos guard-rails de contato.`,
      })
    } else {
      // limite diário/horário: para o lote; sem canal: pula o candidato
      if (/limite diário|horário ativo/.test(outcome.reason)) break
      skipped += 1
      await supabase
        .from('job_candidates')
        .update({ stage: 'unreachable', stage_reason: outcome.reason })
        .eq('id', row.id)
      await logDecision(supabase, {
        orgId: job.org_id, unitId: job.unit_id, jobId: job.id, candidateId: candidate.id,
        decisionType: 'skip_candidate',
        reasoning: `Não foi possível contatar: ${outcome.reason}. Chamando o próximo do ranking.`,
      })
    }
  }

  return { sent, skipped }
}

/**
 * Reforço/desistência de candidatos silenciosos (§7.5): 72h sem
 * resposta → 1 reforço; depois unreachable e o próximo do ranking entra.
 */
export async function nudgeSilentCandidates(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; config: AgentConfig },
): Promise<void> {
  const { job, unit, config } = params
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return

  const limits = getRecruiterLimits(config)
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('job_candidates')
    .select('*, candidates(*)')
    .eq('job_id', job.id)
    .eq('stage', 'contacted')
    .lte('updated_at', cutoff)

  type Row = JobCandidate & { candidates: Candidate | null }
  for (const row of (((data as Row[] | null) ?? []) as Row[]).filter((r) => r.candidates)) {
    const candidate = row.candidates as Candidate

    if (row.outreach_attempts >= limits.candidate_attempts_max) {
      await supabase
        .from('job_candidates')
        .update({ stage: 'unreachable', stage_reason: `${row.outreach_attempts} tentativas sem resposta em 72h` })
        .eq('id', row.id)
      await logDecision(supabase, {
        orgId: job.org_id, unitId: job.unit_id, jobId: job.id, candidateId: candidate.id,
        decisionType: 'unreachable',
        reasoning: `${row.outreach_attempts} tentativas de contato sem resposta em 72h — marcado como inalcançável; próximo do ranking será chamado.`,
      })
      continue
    }

    const history = await getCandidateHistory(supabase, candidate.id, job.id)
    const text = await generateChatReply({
      apiKey,
      systemPrompt: [
        buildScreeningPrompt({
          config, unit, job,
          companyName: unit.name,
          pendingTopics: ['interesse na vaga'],
        }),
        'O candidato não respondeu ao primeiro contato há 3 dias. Escreva UM reforço curto e leve, sem pressionar, reafirmando a oportunidade e facilitando a resposta ("posso te contar mais?").',
      ].join(' '),
      history,
    })
    if (!text) continue

    const outcome = await sendToCandidate({
      supabase, unit, config, candidate,
      jobId: job.id,
      text,
      templateKey: 'recruiter_outreach_2',
    })
    if (outcome.sent) {
      await supabase
        .from('job_candidates')
        .update({ outreach_attempts: row.outreach_attempts + 1 })
        .eq('id', row.id)
      await logDecision(supabase, {
        orgId: job.org_id, unitId: job.unit_id, jobId: job.id, candidateId: candidate.id,
        decisionType: 'follow_up',
        reasoning: 'Candidato sem resposta há 72h — reforço único enviado antes de marcar como inalcançável.',
      })
    }
  }
}

type ScreeningExtraction = ScreeningData & {
  wants_to_withdraw?: boolean
  withdraw_reason?: string
}

type EvaluatorResponse = {
  dimensions?: Record<string, ScoreDimension>
  summary?: string
  strengths?: string[]
  weaknesses?: string[]
  risk?: 'baixo' | 'medio' | 'alto'
  risk_reason?: string
  availability?: string
  expectations_summary?: string
}

/**
 * Processa mensagem inbound de candidato: opt-out LGPD, desistência,
 * atualização do checklist de triagem, resposta conversacional e — ao
 * completar o checklist — avaliação final com nota e relatório.
 */
export async function handleCandidateInbound(
  supabase: SupabaseClient,
  params: {
    job: JobOpening
    jc: JobCandidate
    candidate: Candidate
    unit: Unit
    config: AgentConfig
    lead: Lead | null
    text: string
  },
): Promise<void> {
  const { job, jc, candidate, unit, config, text } = params
  const apiKey = getOpenAIApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não está configurada.')

  const companyName = params.lead?.company_name ?? unit.name

  // 1. Opt-out determinístico (LGPD §18) — imediato, auditável
  if (detectsOptOut(text)) {
    await supabase.from('candidates').update({ opted_out: true }).eq('id', candidate.id)
    await supabase
      .from('job_candidates')
      .update({ stage: 'withdrew', stage_reason: 'pediu para não receber mais mensagens (opt-out)' })
      .eq('id', jc.id)
    await logDecision(supabase, {
      orgId: job.org_id, unitId: job.unit_id, jobId: job.id, candidateId: candidate.id,
      decisionType: 'opt_out',
      reasoning: 'Candidato pediu para não ser contatado. opted_out marcado — nunca mais será contatado por nenhuma vaga.',
    })
    await sendToCandidate({
      supabase, unit, config,
      candidate: { ...candidate, opted_out: false }, // confirmação final ainda é permitida
      jobId: job.id,
      text: 'Entendido, você não receberá mais mensagens nossas. Removemos seu contato da nossa lista. Obrigado e sucesso na sua jornada!',
      templateKey: 'recruiter_opt_out_confirm',
      skipRateLimits: true,
    })
    await recalculateShortlist(supabase, { job, unit, config })
    return
  }

  // 2. Pedido de negociação (§16.4): não negocia — registra e segue
  if (detectsNegotiationRequest(text)) {
    const notes = jc.score_breakdown.screening_data?.notes ?? []
    await supabase
      .from('job_candidates')
      .update({
        score_breakdown: {
          ...jc.score_breakdown,
          screening_data: {
            ...(jc.score_breakdown.screening_data ?? {}),
            notes: [...notes, `pediu negociação de bolsa/valor: "${text.slice(0, 120)}"`],
          },
        },
      })
      .eq('id', jc.id)
  }

  // 3. Escalação por keyword do agent_config (mesma mecânica do SDR)
  const keywords = config.escalation_rules?.keywords ?? []
  const matched = keywords.find((keyword) => text.toLowerCase().includes(keyword.toLowerCase()))
  if (matched) {
    await escalateJob(supabase, {
      job, unit,
      reason: `Candidato ${candidate.name} usou palavra-chave de escalação ("${matched}") na triagem.`,
      context: text.slice(0, 300),
    })
    return
  }

  // 4. Avança o estágio na primeira resposta
  if (jc.stage === 'contacted') {
    await supabase
      .from('job_candidates')
      .update({ stage: 'in_screening', stage_reason: 'respondeu ao outreach' })
      .eq('id', jc.id)
    if (job.status === 'outreach') {
      await supabase.from('job_openings').update({ status: 'screening' }).eq('id', job.id)
    }
  }

  // 5. Extractor do checklist de triagem
  const extraction = await generateStructuredReply<ScreeningExtraction>({
    apiKey,
    systemPrompt: buildScreeningExtractorPrompt(),
    history: [{ role: 'user', content: text }],
  })

  const currentData = jc.score_breakdown.screening_data ?? {}
  const screeningData: ScreeningData = { ...currentData }
  for (const { key } of SCREENING_TOPICS) {
    const value = extraction[key]
    if (value === null || value === undefined) continue
    // string vazia = o modelo preencheu sem resposta real — não conta
    // como tópico coberto (senão a avaliação dispara cedo demais)
    if (typeof value === 'string' && value.trim().length === 0) continue
    ;(screeningData as Record<string, unknown>)[key as string] = value
  }
  if (extraction.modality_fit?.trim()) screeningData.modality_fit = extraction.modality_fit
  if (extraction.notes?.length) {
    screeningData.notes = [...(currentData.notes ?? []), ...extraction.notes]
  }
  if (extraction.open_questions?.length) {
    screeningData.open_questions = [...(currentData.open_questions ?? []), ...extraction.open_questions]
  }

  const newBreakdown = { ...jc.score_breakdown, screening_data: screeningData }
  await supabase.from('job_candidates').update({ score_breakdown: newBreakdown }).eq('id', jc.id)

  // 6. Desistência declarada → memória do motivo (§4.2)
  if (extraction.wants_to_withdraw || screeningData.interested === false) {
    const reason = extraction.withdraw_reason ?? 'declarou desinteresse na triagem'
    await supabase
      .from('job_candidates')
      .update({ stage: 'withdrew', stage_reason: reason })
      .eq('id', jc.id)
    await logDecision(supabase, {
      orgId: job.org_id, unitId: job.unit_id, jobId: job.id, candidateId: candidate.id,
      decisionType: 'disqualify',
      reasoning: `Candidato desistiu do processo: ${reason}. Motivo registrado como memória para futuras vagas.`,
    })
    const bye = await generateChatReply({
      apiKey,
      systemPrompt: [
        buildScreeningPrompt({ config, unit, job, companyName, pendingTopics: [] }),
        'O candidato declarou que não tem interesse. Agradeça com sinceridade, deseje sucesso e diga que ele segue no banco para oportunidades futuras mais alinhadas (se fizer sentido).',
      ].join(' '),
      history: await getCandidateHistory(supabase, candidate.id, job.id),
    })
    if (bye) {
      await sendToCandidate({
        supabase, unit, config, candidate,
        jobId: job.id, text: bye,
        templateKey: 'recruiter_screening_goodbye', skipRateLimits: true,
      })
    }
    await recalculateShortlist(supabase, { job, unit, config })
    return
  }

  const pending = pendingScreeningTopics(screeningData)
  const history = await getCandidateHistory(supabase, candidate.id, job.id)

  // 7. Checklist completo → avaliação final + relatório (§9.5)
  if (pending.length === 0) {
    const transcript = history.map((m) => `${m.role === 'user' ? 'Candidato' : 'Recrutador'}: ${m.content}`).join('\n')
    const evaluation = await generateStructuredReply<EvaluatorResponse>({
      apiKey,
      systemPrompt: buildScreeningEvaluatorPrompt(job),
      history: [
        {
          role: 'user',
          content: `Dados do candidato (sem atributos protegidos): curso ${candidate.course ?? '—'}, ${candidate.semester ?? '—'}º semestre, ${candidate.institution ?? '—'}, cidade ${candidate.city ?? '—'}, habilidades ${JSON.stringify(candidate.skills)}, DISC ${candidate.disc_profile ?? '—'}.\nChecklist da triagem: ${JSON.stringify(screeningData)}.\nTranscrição:\n${transcript}`,
        },
      ],
      model: process.env.RECRUITER_RANKING_MODEL || 'gpt-4o',
      maxTokens: 2000,
    })

    const aiScore = evaluation.dimensions ? computeWeightedScore(evaluation.dimensions) : (jc.match_score ?? 0)
    const report: CandidateReport = {
      summary: evaluation.summary ?? '',
      strengths: evaluation.strengths ?? [],
      weaknesses: evaluation.weaknesses ?? [],
      score: aiScore,
      compatibility_pct: Math.round(aiScore),
      risk: evaluation.risk ?? 'medio',
      risk_reason: evaluation.risk_reason ?? '',
      availability: evaluation.availability ?? screeningData.availability ?? '',
      expectations: evaluation.expectations_summary ?? screeningData.salary_expectation ?? '',
    }

    await supabase
      .from('job_candidates')
      .update({
        stage: 'screened',
        screened_at: new Date().toISOString(),
        ai_score: aiScore,
        report,
        score_breakdown: { ...newBreakdown, dimensions: evaluation.dimensions ?? jc.score_breakdown.dimensions },
        stage_reason: `triagem concluída com nota ${aiScore}`,
      })
      .eq('id', jc.id)

    await logRecruiterEvent(supabase, {
      orgId: job.org_id, unitId: job.unit_id, jobId: job.id, candidateId: candidate.id,
      eventType: 'candidate.screened',
      message: `Triagem concluída: nota ${aiScore} (risco ${report.risk}).`,
      metadata: { ai_score: aiScore },
    })

    const closing = await generateChatReply({
      apiKey,
      systemPrompt: [
        buildScreeningPrompt({ config, unit, job, companyName, pendingTopics: [] }),
        'A triagem terminou. Agradeça as respostas e explique o próximo passo com honestidade: o perfil dele será apresentado à empresa junto com outros candidatos, e você retorna com novidades em alguns dias. NÃO prometa vaga nem aprovação.',
      ].join(' '),
      history: [...history, { role: 'user', content: text }],
    })
    if (closing) {
      await sendToCandidate({
        supabase, unit, config, candidate,
        jobId: job.id, text: closing,
        templateKey: 'recruiter_screening_done', skipRateLimits: true,
      })
    }

    await recalculateShortlist(supabase, { job, unit, config })
    return
  }

  // 8. Triagem continua: próxima resposta conversacional
  const reply = await generateChatReply({
    apiKey,
    systemPrompt: buildScreeningPrompt({ config, unit, job, companyName, pendingTopics: pending }),
    history: [...history, { role: 'user', content: text }],
  })
  if (reply) {
    await sendToCandidate({
      supabase, unit, config, candidate,
      jobId: job.id, text: reply,
      templateKey: 'recruiter_screening_reply', skipRateLimits: true,
    })
  }
}
