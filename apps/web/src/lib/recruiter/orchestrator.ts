import type { SupabaseClient } from '@supabase/supabase-js'
import { generateChatReply, generateStructuredReply, getOpenAIApiKey } from '@/lib/openai'
import { sendRecruiterEmail } from '@/lib/email'
import { logSystemEvent, shouldNotifyForEvent } from '@/lib/system-events'
import type { AgentConfig, Lead, Unit } from '@/lib/types'
import { buildCompanyReviewClassifierPrompt, buildRecruiterBasePrompt, buildProfileExtractorPrompt } from './prompts'
import { getRecruiterLimits } from './guardrails'
import { logDecision, logRecruiterEvent } from './log'
import { sendToCompany } from './messaging'
import { presentShortlist, sendRejectionFeedback, buildHandoffHtml, type ShortlistedEntry } from './reporting'
import { runSourcing } from './sourcing-engine'
import type { Candidate, JobCandidate, JobOpening, JobProfile } from './types'

// Orchestrator (§4, §7.7, §7.8, §17): máquina de estados da vaga,
// montagem/apresentação da shortlist, decisão da empresa, handoff
// humano e escalonamento. Toda decisão autônoma → recruiter_decisions.

export async function getLeadForJob(supabase: SupabaseClient, job: JobOpening): Promise<Lead | null> {
  if (!job.lead_id) return null
  const { data } = await supabase.from('leads').select('*').eq('id', job.lead_id).maybeSingle()
  return data as Lead | null
}

async function getOwnerEmail(supabase: SupabaseClient, orgId: string): Promise<string | null> {
  const { data } = await supabase.from('organizations').select('owner_email').eq('id', orgId).maybeSingle()
  return (data as { owner_email: string | null } | null)?.owner_email ?? null
}

async function getEntries(
  supabase: SupabaseClient,
  jobId: string,
  stages: string[],
): Promise<ShortlistedEntry[]> {
  const { data } = await supabase
    .from('job_candidates')
    .select('*, candidates(*)')
    .eq('job_id', jobId)
    .in('stage', stages)
    .order('ai_score', { ascending: false, nullsFirst: false })

  type Row = JobCandidate & { candidates: Candidate | null }
  return (((data as Row[] | null) ?? []) as Row[])
    .filter((row) => row.candidates)
    .map((row) => {
      const { candidates, ...jc } = row
      return { jc: jc as JobCandidate, candidate: candidates as Candidate }
    })
}

/** Escalonamento para humano (§17): e-mail + estado + decision log. */
export async function escalateJob(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; reason: string; context?: string },
): Promise<void> {
  const { job, unit, reason, context } = params

  await supabase
    .from('job_openings')
    .update({ status: 'escalated_human', previous_status: job.status })
    .eq('id', job.id)

  await logDecision(supabase, {
    orgId: job.org_id,
    unitId: job.unit_id,
    jobId: job.id,
    decisionType: 'escalate',
    reasoning: reason,
    metadata: context ? { context } : {},
  })

  await logRecruiterEvent(supabase, {
    orgId: job.org_id,
    unitId: job.unit_id,
    jobId: job.id,
    eventType: 'job.escalated',
    message: reason,
  })

  // Janela anti-spam de 6h por tipo, mesmo mecanismo do SDR
  const notify = await shouldNotifyForEvent(supabase, {
    eventType: `recruiter_escalated_${job.id}`,
    unitId: unit.id,
  })
  if (!notify) return

  await logSystemEvent(supabase, {
    level: 'warning',
    source: 'recruiter',
    eventType: `recruiter_escalated_${job.id}`,
    message: `Vaga "${job.title}" escalada para humano: ${reason}`,
    orgId: job.org_id,
    unitId: unit.id,
  })

  const ownerEmail = await getOwnerEmail(supabase, job.org_id)
  if (ownerEmail) {
    await sendRecruiterEmail({
      to: ownerEmail,
      subject: `[${unit.name}] Vaga "${job.title}" precisa de você`,
      html: `
        <p>O Recruiter IA escalou a vaga <strong>${job.title}</strong> para atendimento humano.</p>
        <p><strong>Motivo:</strong> ${reason}</p>
        ${context ? `<p><strong>Contexto:</strong> ${context}</p>` : ''}
        <p>Acesse o painel (Recrutador IA → vaga) para agir e devolver o processo ao agente.</p>
      `,
    })
  }
}

/**
 * Recalcula a shortlist (§7.6): candidatos triados acima do corte viram
 * shortlisted; quando a meta é atingida (ou o pipeline se esgota com
 * pelo menos 1 aprovado), apresenta à empresa. Nunca completa número
 * com candidato abaixo do corte (§15).
 */
export async function recalculateShortlist(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; config: AgentConfig },
): Promise<void> {
  const { job, unit, config } = params
  if (!['outreach', 'screening', 'shortlist_ready', 'sourcing_expanded'].includes(job.status)) return

  const limits = getRecruiterLimits(config)

  const screenedEntries = await getEntries(supabase, job.id, ['screened', 'shortlisted'])
  const aboveCutoff = screenedEntries.filter(
    (entry) => (entry.jc.ai_score ?? 0) >= limits.screening_score_cutoff,
  )

  // Reprova (com motivo) quem ficou abaixo do corte
  for (const entry of screenedEntries) {
    if ((entry.jc.ai_score ?? 0) < limits.screening_score_cutoff && entry.jc.stage === 'screened') {
      await supabase
        .from('job_candidates')
        .update({
          stage: 'disqualified',
          stage_reason: `nota de triagem ${entry.jc.ai_score} abaixo do corte ${limits.screening_score_cutoff}`,
        })
        .eq('id', entry.jc.id)
      await logDecision(supabase, {
        orgId: job.org_id,
        unitId: job.unit_id,
        jobId: job.id,
        candidateId: entry.candidate.id,
        decisionType: 'disqualify',
        reasoning: `Nota de triagem ${entry.jc.ai_score} abaixo do corte de qualidade ${limits.screening_score_cutoff} — não entra na shortlist.`,
      })
    }
  }

  const target = job.target_shortlist_size
  const top = aboveCutoff.slice(0, target)

  for (const entry of top) {
    if (entry.jc.stage !== 'shortlisted') {
      await supabase
        .from('job_candidates')
        .update({ stage: 'shortlisted', stage_reason: 'entre os melhores da triagem' })
        .eq('id', entry.jc.id)
    }
  }

  // Pipeline esgotado = ninguém mais a caminho da triagem
  const { count: inFlight } = await supabase
    .from('job_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', job.id)
    .in('stage', ['sourced', 'ranked', 'contacted', 'in_screening'])

  const pipelineExhausted = (inFlight ?? 0) === 0
  const ready = top.length >= target || (pipelineExhausted && top.length > 0)
  if (!ready) return

  await supabase.from('job_openings').update({ status: 'shortlist_ready' }).eq('id', job.id)
  await logRecruiterEvent(supabase, {
    orgId: job.org_id,
    unitId: job.unit_id,
    jobId: job.id,
    eventType: 'shortlist.ready',
    message: `Shortlist pronta com ${top.length} candidato(s)${top.length < target ? ` (meta era ${target} — pipeline esgotado, seguimos com transparência)` : ''}.`,
  })
  await logDecision(supabase, {
    orgId: job.org_id,
    unitId: job.unit_id,
    jobId: job.id,
    decisionType: 'shortlist',
    reasoning:
      top.length >= target
        ? `${top.length} candidatos triados acima do corte — shortlist completa.`
        : `Pipeline esgotado com ${top.length} candidato(s) acima do corte. Apresentando lista menor com transparência em vez de inflar com candidatos abaixo do padrão.`,
  })

  const lead = await getLeadForJob(supabase, job)
  if (!lead) {
    await escalateJob(supabase, {
      job: { ...job, status: 'shortlist_ready' },
      unit,
      reason: 'Shortlist pronta, mas a vaga não tem empresa (lead) vinculada para receber a apresentação.',
    })
    return
  }

  const shortlisted = await getEntries(supabase, job.id, ['shortlisted'])
  await presentShortlist(supabase, {
    job: { ...job, status: 'shortlist_ready' },
    unit,
    config,
    lead,
    shortlisted,
  })
}

/** Aprendizado relacional (§8.3): memória por empresa cliente. */
async function updateCompanyMemory(
  supabase: SupabaseClient,
  job: JobOpening,
  update: { approvedSummary?: string; rejectionPattern?: string },
): Promise<void> {
  if (!job.lead_id) return
  const { data } = await supabase
    .from('company_recruiting_profiles')
    .select('*')
    .eq('org_id', job.org_id)
    .eq('lead_id', job.lead_id)
    .maybeSingle()

  const existing = data as { id: string; preferences: Record<string, unknown>; rejection_patterns: unknown[] } | null
  const preferences = { ...(existing?.preferences ?? {}) }
  const rejectionPatterns = [...(existing?.rejection_patterns ?? [])]

  if (update.approvedSummary) {
    const approved = Array.isArray(preferences.approved_profiles) ? (preferences.approved_profiles as string[]) : []
    preferences.approved_profiles = [...approved, update.approvedSummary].slice(-10)
  }
  if (update.rejectionPattern) rejectionPatterns.push(update.rejectionPattern)

  if (existing) {
    await supabase
      .from('company_recruiting_profiles')
      .update({ preferences, rejection_patterns: rejectionPatterns })
      .eq('id', existing.id)
  } else {
    await supabase.from('company_recruiting_profiles').insert({
      org_id: job.org_id,
      lead_id: job.lead_id,
      preferences,
      rejection_patterns: rejectionPatterns,
    })
  }
}

/**
 * Empresa escolheu um candidato (§7.8): aprova o escolhido, devolve
 * feedback a todos os triados, atualiza memória, envia dossiê de
 * handoff e encerra a participação do agente.
 */
export async function finalizeSelection(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; config: AgentConfig; selectedJcId: string; decidedBy: string },
): Promise<{ ok: boolean; error?: string }> {
  const { job, unit, config, selectedJcId, decidedBy } = params

  const allEntries = await getEntries(supabase, job.id, [
    'screened', 'shortlisted', 'presented', 'approved', 'not_selected',
  ])
  const selected = allEntries.find((entry) => entry.jc.id === selectedJcId)
  if (!selected) return { ok: false, error: 'Candidato escolhido não encontrado na vaga.' }

  await supabase
    .from('job_candidates')
    .update({ stage: 'approved', stage_reason: `escolhido pela empresa (${decidedBy})` })
    .eq('id', selected.jc.id)

  await supabase
    .from('job_openings')
    .update({ status: 'candidate_selected', selected_candidate_id: selected.jc.id })
    .eq('id', job.id)

  await logRecruiterEvent(supabase, {
    orgId: job.org_id,
    unitId: job.unit_id,
    jobId: job.id,
    candidateId: selected.candidate.id,
    eventType: 'candidate.selected',
    message: `Empresa escolheu ${selected.candidate.name} (${decidedBy}).`,
  })

  await updateCompanyMemory(supabase, job, {
    approvedSummary: selected.jc.report?.summary ?? `${selected.candidate.course ?? 'perfil'} aprovado na vaga ${job.title}`,
  })

  // Devolutiva individual a todos os demais triados (§7.8.2)
  for (const entry of allEntries) {
    if (entry.jc.id === selected.jc.id || entry.jc.stage === 'not_selected') continue
    await supabase
      .from('job_candidates')
      .update({ stage: 'not_selected', stage_reason: 'empresa escolheu outro candidato' })
      .eq('id', entry.jc.id)
    await sendRejectionFeedback(supabase, { job, unit, config, jc: entry.jc, candidate: entry.candidate })
  }

  // Handoff humano com dossiê (§7.8.4) — financial_records não é tocado (fatura é ação humana)
  const ownerEmail = await getOwnerEmail(supabase, job.org_id)
  const lead = await getLeadForJob(supabase, job)
  if (ownerEmail) {
    await sendRecruiterEmail({
      to: ownerEmail,
      subject: `[${unit.name}] Vaga "${job.title}" preenchida — handoff para contratação`,
      html: buildHandoffHtml({ job, unit, lead, selected, shortlisted: allEntries }),
    })
  }

  await supabase
    .from('job_openings')
    .update({ status: 'handed_off', handed_off_to: ownerEmail })
    .eq('id', job.id)

  await logRecruiterEvent(supabase, {
    orgId: job.org_id,
    unitId: job.unit_id,
    jobId: job.id,
    eventType: 'job.handed_off',
    message: `Processo transferido para humano${ownerEmail ? ` (${ownerEmail})` : ''} para documentação e contrato.`,
  })

  return { ok: true }
}

/** Cancela a vaga com devolutiva imediata e honesta aos candidatos em processo (exceção 10). */
export async function cancelJob(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; config: AgentConfig; reason: string },
): Promise<void> {
  const { job, unit, config, reason } = params

  await supabase.from('job_openings').update({ status: 'cancelled' }).eq('id', job.id)
  await logRecruiterEvent(supabase, {
    orgId: job.org_id,
    unitId: job.unit_id,
    jobId: job.id,
    eventType: 'job.cancelled',
    message: reason,
  })

  const inProcess = await getEntries(supabase, job.id, [
    'contacted', 'in_screening', 'screened', 'shortlisted', 'presented',
  ])
  for (const entry of inProcess) {
    await supabase
      .from('job_candidates')
      .update({ stage: 'not_selected', stage_reason: 'vaga cancelada pela empresa' })
      .eq('id', entry.jc.id)
    await sendRejectionFeedback(supabase, { job, unit, config, jc: entry.jc, candidate: entry.candidate })
  }
}

type ReviewClassification = {
  intent?: 'selected' | 'adjust_profile' | 'question' | 'cancel' | 'other'
  selected_ref?: string | null
  detail?: string
}

/**
 * Mensagem da empresa durante company_review (§7.7/§7.8): decide entre
 * escolha confirmada, pedido de ajuste, dúvida ou cancelamento.
 * Aprovação nunca é inferida — só com confirmação explícita (§4.2).
 */
export async function handleCompanyReviewInbound(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; config: AgentConfig; lead: Lead; text: string },
): Promise<void> {
  const { job, unit, config, lead, text } = params
  const apiKey = getOpenAIApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não está configurada.')

  const presented = await getEntries(supabase, job.id, ['presented', 'shortlisted'])
  const refs = presented.map((entry, index) => ({ ref: `C${index + 1}`, entry }))

  const classification = await generateStructuredReply<ReviewClassification>({
    apiKey,
    systemPrompt: buildCompanyReviewClassifierPrompt({
      job,
      shortlistNames: refs.map(({ ref, entry }) => ({ ref, name: entry.candidate.name })),
    }),
    history: [{ role: 'user', content: text }],
  })

  if (classification.intent === 'selected' && classification.selected_ref) {
    const chosen = refs.find((r) => r.ref === classification.selected_ref)
    if (chosen) {
      const reply = await generateChatReply({
        apiKey,
        systemPrompt: [
          buildRecruiterBasePrompt(config, unit),
          `A empresa confirmou a escolha de ${chosen.entry.candidate.name} para a vaga "${job.title}". Agradeça, confirme a escolha e avise que o responsável humano assume agora a parte de documentação e contrato.`,
        ].join(' '),
        history: [{ role: 'user', content: text }],
      })
      if (reply) {
        await sendToCompany({
          supabase, unit, config,
          leadId: lead.id, leadPhone: lead.phone, leadEmail: lead.email,
          text: reply, templateKey: 'recruiter_selection_confirmed', skipRateLimits: true,
        })
      }
      await finalizeSelection(supabase, {
        job, unit, config,
        selectedJcId: chosen.entry.jc.id,
        decidedBy: 'confirmação explícita na conversa',
      })
      return
    }
  }

  if (classification.intent === 'adjust_profile') {
    // Ajuste de perfil → memória + novo ciclo de sourcing encurtado (§7.7)
    const extracted = await generateStructuredReply<JobProfile>({
      apiKey,
      systemPrompt: buildProfileExtractorPrompt(job.profile),
      history: [{ role: 'user', content: text }],
    })
    const mergedProfile: JobProfile = { ...job.profile }
    for (const [key, value] of Object.entries(extracted)) {
      if (value !== null && value !== undefined && key !== 'low_confidence_fields') {
        ;(mergedProfile as Record<string, unknown>)[key] = value
      }
    }
    await supabase.from('job_openings').update({ profile: mergedProfile, status: 'sourcing' }).eq('id', job.id)
    await updateCompanyMemory(supabase, job, {
      rejectionPattern: classification.detail ?? text.slice(0, 200),
    })
    await logDecision(supabase, {
      orgId: job.org_id,
      unitId: job.unit_id,
      jobId: job.id,
      decisionType: 'resume',
      reasoning: `Empresa pediu ajuste na busca após ver a shortlist: ${classification.detail ?? text.slice(0, 120)}. Perfil atualizado e novo ciclo de sourcing iniciado.`,
    })

    const reply = await generateChatReply({
      apiKey,
      systemPrompt: [
        buildRecruiterBasePrompt(config, unit),
        `A empresa pediu para ajustar a busca da vaga "${job.title}" (${classification.detail ?? 'ajuste de perfil'}). Confirme que entendeu o ajuste e que você já vai buscar novos candidatos com esse novo direcionamento.`,
      ].join(' '),
      history: [{ role: 'user', content: text }],
    })
    if (reply) {
      await sendToCompany({
        supabase, unit, config,
        leadId: lead.id, leadPhone: lead.phone, leadEmail: lead.email,
        text: reply, templateKey: 'recruiter_adjust_confirmed', skipRateLimits: true,
      })
    }

    try {
      await runSourcing(supabase, {
        job: { ...job, profile: mergedProfile, status: 'sourcing' },
        unit,
        config,
      })
    } catch (error) {
      console.error(`[recruiter_review] novo sourcing falhou (cron reprocessa): ${error instanceof Error ? error.message : String(error)}`)
    }
    return
  }

  if (classification.intent === 'cancel') {
    await cancelJob(supabase, { job, unit, config, reason: `Empresa cancelou a vaga na conversa: ${classification.detail ?? text.slice(0, 120)}` })
    const reply = await generateChatReply({
      apiKey,
      systemPrompt: [
        buildRecruiterBasePrompt(config, unit),
        `A empresa cancelou a vaga "${job.title}". Confirme o cancelamento com cordialidade, avise que os candidatos em processo receberão uma devolutiva e se coloque à disposição para novas vagas.`,
      ].join(' '),
      history: [{ role: 'user', content: text }],
    })
    if (reply) {
      await sendToCompany({
        supabase, unit, config,
        leadId: lead.id, leadPhone: lead.phone, leadEmail: lead.email,
        text: reply, templateKey: 'recruiter_cancel_confirmed', skipRateLimits: true,
      })
    }
    return
  }

  // Dúvida ou conversa geral: responde usando somente os relatórios reais
  const reportsContext = refs
    .map(({ ref, entry }) =>
      `${ref} ${entry.candidate.name}: nota ${entry.jc.ai_score ?? '—'}; ${entry.jc.report?.summary ?? 'sem relatório'}; pontos fortes: ${entry.jc.report?.strengths?.join(', ') ?? '—'}; pontos de atenção: ${entry.jc.report?.weaknesses?.join(', ') ?? '—'}`,
    )
    .join(' | ')

  const reply = await generateChatReply({
    apiKey,
    systemPrompt: [
      buildRecruiterBasePrompt(config, unit),
      `A empresa está avaliando a shortlist da vaga "${job.title}" e mandou uma mensagem. Responda usando SOMENTE os dados reais dos relatórios (não invente nada): ${reportsContext}.`,
      'Se a pergunta não puder ser respondida com esses dados, diga que vai verificar e retorna. Termine incentivando gentilmente a decisão.',
    ].join(' '),
    history: [{ role: 'user', content: text }],
  })
  if (reply) {
    await sendToCompany({
      supabase, unit, config,
      leadId: lead.id, leadPhone: lead.phone, leadEmail: lead.email,
      text: reply, templateKey: 'recruiter_review_reply', skipRateLimits: true,
    })
  }
}
