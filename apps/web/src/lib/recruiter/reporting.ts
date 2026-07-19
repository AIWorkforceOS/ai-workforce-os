import type { SupabaseClient } from '@supabase/supabase-js'
import { generateChatReply, getOpenAIApiKey } from '@/lib/openai'
import { sendRecruiterEmail } from '@/lib/email'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import type { AgentConfig, Lead, Unit } from '@/lib/types'
import { buildCompanyFollowUpPrompt, buildRejectionPrompt, buildRecruiterBasePrompt } from './prompts'
import { sendToCandidate, sendToCompany } from './messaging'
import { logDecision, logRecruiterEvent } from './log'
import type { Candidate, JobCandidate, JobOpening } from './types'

// Reporting & Presentation Engine (§7.6–§7.8): apresentação da
// shortlist à empresa, follow-ups de decisão com ângulos diferentes,
// devolutivas respeitosas aos não selecionados e dossiê de handoff.

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://SEU-DOMINIO.vercel.app').replace(/\/+$/, '')
}

export function shortlistUrl(jobId: string): string {
  return `${appBaseUrl()}/dashboard/recruiter/jobs/${jobId}/shortlist`
}

export type ShortlistedEntry = { jc: JobCandidate; candidate: Candidate }

/**
 * Envia a shortlist à empresa (WhatsApp com link + e-mail com resumo) e
 * move a vaga para company_review. Estado dos candidatos → presented.
 */
export async function presentShortlist(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; config: AgentConfig; lead: Lead; shortlisted: ShortlistedEntry[] },
): Promise<boolean> {
  const { job, unit, config, lead, shortlisted } = params
  const apiKey = getOpenAIApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não está configurada.')

  const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unit.org_id)
  const link = shortlistUrl(job.id)
  const count = shortlisted.length
  const shortText = await generateChatReply({
    apiKey,
    systemPrompt: [
      buildRecruiterBasePrompt(config, unit, organizationProfile),
      `Avise a empresa que a seleção da vaga "${job.title}" está pronta: ${count} candidato(s) triado(s) e avaliado(s), com relatório individual em ${link}.`,
      count < job.target_shortlist_size
        ? `IMPORTANTE: a meta eram ${job.target_shortlist_size} candidatos, mas apenas ${count} passaram no corte de qualidade. Seja transparente sobre isso — nunca inflamos a lista com candidato abaixo do padrão.`
        : '',
      'Peça que a empresa avalie e responda com o candidato escolhido ou com ajustes desejados.',
    ]
      .filter(Boolean)
      .join(' '),
    history: [{ role: 'user', content: 'Gere a mensagem de apresentação da shortlist.' }],
  })
  if (!shortText) return false

  const outcome = await sendToCompany({
    supabase,
    unit,
    config,
    leadId: lead.id,
    leadPhone: lead.phone,
    leadEmail: lead.email,
    text: `${shortText}\n\n${link}`,
    templateKey: 'recruiter_shortlist_presented',
  })
  if (!outcome.sent) return false

  // E-mail complementar com o resumo executivo (quando a empresa tem e-mail)
  if (lead.email) {
    await sendRecruiterEmail({
      to: lead.email,
      subject: `[${unit.name}] Shortlist da vaga ${job.title} — ${count} candidato(s)`,
      html: buildShortlistEmailHtml(job, shortlisted, link),
    })
  }

  const presentedAt = new Date().toISOString()
  for (const entry of shortlisted) {
    await supabase
      .from('job_candidates')
      .update({ stage: 'presented', presented_at: presentedAt })
      .eq('id', entry.jc.id)
  }

  await supabase
    .from('job_openings')
    .update({ status: 'company_review', follow_up_count: 0 })
    .eq('id', job.id)

  await logRecruiterEvent(supabase, {
    orgId: job.org_id,
    unitId: job.unit_id,
    jobId: job.id,
    eventType: 'shortlist.presented',
    message: `Shortlist com ${count} candidato(s) apresentada à empresa via ${outcome.channel}.`,
    metadata: { count, link },
  })

  return true
}

function buildShortlistEmailHtml(job: JobOpening, shortlisted: ShortlistedEntry[], link: string): string {
  const rows = shortlisted
    .map((entry, index) => {
      const report = entry.jc.report
      return `<tr>
        <td style="padding:6px 10px;">${index + 1}. <strong>${entry.candidate.name}</strong></td>
        <td style="padding:6px 10px;">${entry.candidate.course ?? '—'}</td>
        <td style="padding:6px 10px;">${entry.jc.ai_score ?? '—'}</td>
        <td style="padding:6px 10px;">${report?.risk ?? '—'}</td>
      </tr>`
    })
    .join('')
  return `
    <p>A seleção para a vaga <strong>${job.title}</strong> está pronta.</p>
    <table style="border-collapse:collapse;">
      <tr><th style="padding:6px 10px;text-align:left;">Candidato</th><th style="padding:6px 10px;text-align:left;">Curso</th><th style="padding:6px 10px;text-align:left;">Nota</th><th style="padding:6px 10px;text-align:left;">Risco</th></tr>
      ${rows}
    </table>
    <p>Relatórios completos, comparativo e próximos passos: <a href="${link}">${link}</a></p>
  `
}

/** Follow-up N/3 à empresa durante company_review (§7.7). */
export async function sendCompanyFollowUp(
  supabase: SupabaseClient,
  params: {
    job: JobOpening
    unit: Unit
    config: AgentConfig
    lead: Lead
    attempt: number
    presentedAt: string
    topCandidateFact: string | null
    previousFollowUps: string[]
  },
): Promise<boolean> {
  const { job, unit, config, lead } = params
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return false

  const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unit.org_id)
  const text = await generateChatReply({
    apiKey,
    systemPrompt: buildCompanyFollowUpPrompt({ ...params, organizationProfile }),
    history: [{ role: 'user', content: 'Gere o follow-up.' }],
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
    templateKey: `recruiter_company_followup_${params.attempt}`,
  })

  if (outcome.sent) {
    await supabase.from('job_openings').update({ follow_up_count: params.attempt }).eq('id', job.id)
    await logRecruiterEvent(supabase, {
      orgId: job.org_id,
      unitId: job.unit_id,
      jobId: job.id,
      eventType: 'company.followup_sent',
      message: `Follow-up ${params.attempt}/3 enviado à empresa sobre a shortlist.`,
    })
    await logDecision(supabase, {
      orgId: job.org_id,
      unitId: job.unit_id,
      jobId: job.id,
      decisionType: 'follow_up',
      reasoning: `Empresa sem responder a shortlist — follow-up ${params.attempt}/3 com ângulo ${params.attempt === 1 ? 'destaque do candidato mais forte' : params.attempt === 2 ? 'disponibilidade real dos candidatos' : 'oferta de ajustar a busca'}.`,
    })
  }
  return outcome.sent
}

/**
 * Devolutiva individual, gerada (nunca template), a candidato não
 * selecionado (§7.8.2) — importa para a reputação do cliente.
 */
export async function sendRejectionFeedback(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; config: AgentConfig; jc: JobCandidate; candidate: Candidate },
): Promise<void> {
  const { job, unit, config, jc, candidate } = params
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return

  const strength = jc.report?.strengths?.[0] ?? null
  const keepInBank = !candidate.opted_out && candidate.consent_status !== 'revoked'
  const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unit.org_id)

  const text = await generateChatReply({
    apiKey,
    systemPrompt: buildRejectionPrompt({
      config,
      unit,
      jobTitle: job.title,
      candidateFirstName: candidate.name.split(' ')[0] ?? candidate.name,
      realStrength: strength,
      keepInBank,
      organizationProfile,
    }),
    history: [{ role: 'user', content: 'Gere a devolutiva.' }],
  })
  if (!text) return

  const outcome = await sendToCandidate({
    supabase,
    unit,
    config,
    candidate,
    jobId: job.id,
    text,
    templateKey: 'recruiter_rejection_feedback',
    skipRateLimits: true, // devolutiva é compromisso ético — não fica presa em limite diário
  })

  if (outcome.sent) {
    await logDecision(supabase, {
      orgId: job.org_id,
      unitId: job.unit_id,
      jobId: job.id,
      candidateId: candidate.id,
      decisionType: 'reject_feedback',
      reasoning: 'Devolutiva respeitosa enviada ao candidato não selecionado nesta vaga.',
    })
  }
}

/** Dossiê completo do handoff ao humano (§7.8.4). */
export function buildHandoffHtml(params: {
  job: JobOpening
  unit: Unit
  lead: Lead | null
  selected: { jc: JobCandidate; candidate: Candidate } | null
  shortlisted: ShortlistedEntry[]
}): string {
  const { job, unit, lead, selected, shortlisted } = params
  const profile = job.profile
  const candidateBlock = selected
    ? `<p><strong>Candidato escolhido:</strong> ${selected.candidate.name}
        ${selected.candidate.phone ? ` — ${selected.candidate.phone}` : ''}
        ${selected.candidate.email ? ` — ${selected.candidate.email}` : ''}<br/>
        Nota da triagem: ${selected.jc.ai_score ?? '—'} | ${selected.jc.report?.summary ?? ''}</p>`
    : '<p><strong>Nenhum candidato escolhido ainda.</strong></p>'

  const others = shortlisted
    .filter((entry) => entry.jc.id !== selected?.jc.id)
    .map((entry) => `<li>${entry.candidate.name} — nota ${entry.jc.ai_score ?? '—'}</li>`)
    .join('')

  return `
    <p>O Recruiter IA da unidade <strong>${unit.name}</strong> concluiu o processo da vaga
    <strong>${job.title}</strong>${lead ? ` (empresa ${lead.company_name})` : ''} e está transferindo para você
    a etapa de documentação e contrato.</p>
    ${candidateBlock}
    <p><strong>Perfil da vaga:</strong> ${profile.ideal_profile_summary ?? job.title}</p>
    ${others ? `<p><strong>Demais candidatos da shortlist:</strong></p><ul>${others}</ul>` : ''}
    <p>Dossiê completo (relatórios, transcrições e decision log):
    <a href="${shortlistUrl(job.id)}">${shortlistUrl(job.id)}</a></p>
    <p><em>O Recruiter não participa de contrato ou documentos — a partir daqui o processo é humano.</em></p>
  `
}
