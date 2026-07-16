import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentConfig, Unit } from '@/lib/types'
import { getOpenAIApiKey, generateChatReply } from '@/lib/openai'
import { sendRecruiterEmail } from '@/lib/email'
import { logSystemEvent, shouldNotifyForEvent } from '@/lib/system-events'
import { logDecision, logRecruiterEvent } from './log'
import { getRecruiterLimits } from './guardrails'
import { getOwnerEmail } from './orchestrator'
import { countAvailableCandidates } from './sourcing-engine'
import { buildSourcingStrategyPrompt } from './prompts'
import {
  getPartnerRecruitingClient,
  isPartnerRecruitingMisconfigured,
  jobOpeningToPartnerVacancyInput,
} from './partner-recruiting-client'
import type { JobOpening, JobProfile } from './types'

// Sincronização do Recruiter com o sistema de vagas de um parceiro
// externo (hoje: Smarter — lib/recruiter/smarter-recruiting-client.ts),
// ativa só quando units.recruiting_integration_mode = 'smarter'
// (migration 019). Publica a vaga nativa (job_openings) no parceiro e
// vai adicionando lá os candidatos sourced e qualificados, até ter uma
// amostra "pronta" para a empresa avaliar. Fala só com o contrato
// genérico (partner-recruiting-client.ts) — nenhuma menção a Smarter
// além do nome do parceiro nos logs.

const TARGET_READY_CANDIDATES = 3

/** Job já passou por pelo menos uma rodada de sourcing (interno + parceiro). */
const SOURCING_ATTEMPTED_STATUSES = new Set([
  'outreach',
  'screening',
  'sourcing_expanded',
  'shortlist_ready',
  'presented',
  'company_review',
  'candidate_selected',
  'stalled',
])

type EligibleRow = {
  id: string
  candidate_id: string
  candidates: { source: string; external_ref: string | null } | null
}

/** Avisa 1x/dia quando a unidade ligou o modo smarter mas a configuração está incompleta (falta companyId). */
async function warnIfMisconfigured(supabase: SupabaseClient, unit: Unit): Promise<void> {
  if (!isPartnerRecruitingMisconfigured(unit)) return
  const notify = await shouldNotifyForEvent(supabase, {
    eventType: `partner_recruiting_misconfigured_${unit.id}`,
    unitId: unit.id,
  })
  if (!notify) return
  await logSystemEvent(supabase, {
    level: 'warning',
    source: 'recruiter',
    eventType: `partner_recruiting_misconfigured_${unit.id}`,
    message: `Unidade "${unit.name}" está em recruiting_integration_mode = 'smarter' com token configurado, mas smarter_recruiting_company_id está vazio — a integração de recrutamento parceiro não consegue publicar vaga nenhuma sem o companyId da empresa na Smarter.`,
    orgId: unit.org_id,
    unitId: unit.id,
  })
}

/**
 * Ponto de entrada por vaga (chamado pelo cron para cada job ativo de
 * unidade em modo smarter). Idempotente: cria a vaga no parceiro uma
 * única vez, só adiciona candidatos ainda não adicionados, e só
 * notifica o humano depois de uma rodada de sourcing já ter rodado
 * (busca "razoavelmente esgotada" — antes disso pode aparecer mais
 * gente no próximo ciclo do cron).
 */
export async function syncJobWithPartnerRecruiting(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; config: AgentConfig },
): Promise<void> {
  const { job, unit, config } = params
  const client = getPartnerRecruitingClient(unit)
  if (!client) {
    await warnIfMisconfigured(supabase, unit)
    return
  }

  const limits = getRecruiterLimits(config)

  let vacancyId = job.smarter_recruiting_vacancy_id
  if (!vacancyId) {
    try {
      const vacancy = await client.createVacancy(jobOpeningToPartnerVacancyInput(job))
      vacancyId = vacancy.id
      await supabase.from('job_openings').update({ smarter_recruiting_vacancy_id: vacancyId }).eq('id', job.id)
      await logRecruiterEvent(supabase, {
        orgId: job.org_id,
        unitId: job.unit_id,
        jobId: job.id,
        eventType: 'partner_recruiting.vacancy_created',
        message: `Vaga publicada no parceiro ${client.partnerName} (id ${vacancyId}).`,
      })
    } catch (error) {
      await logSystemEvent(supabase, {
        level: 'error',
        source: 'recruiter',
        eventType: 'partner_recruiting_vacancy_failed',
        message: `Falha ao publicar a vaga "${job.title}" no parceiro ${client.partnerName}: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        orgId: job.org_id,
        unitId: unit.id,
        metadata: { job_id: job.id },
      })
      return
    }
  }

  const { data: addedRows } = await supabase
    .from('job_candidates')
    .select('id')
    .eq('job_id', job.id)
    .not('smarter_recruiting_added_at', 'is', null)
  let addedCount = (addedRows as { id: string }[] | null)?.length ?? 0

  if (addedCount < TARGET_READY_CANDIDATES) {
    const { data: candidateRows } = await supabase
      .from('job_candidates')
      .select('id, candidate_id, candidates(source, external_ref)')
      .eq('job_id', job.id)
      .is('smarter_recruiting_added_at', null)
      .gte('match_score', limits.match_score_qualified)
      .order('match_score', { ascending: false })

    const eligible = ((candidateRows as EligibleRow[] | null) ?? []).filter(
      (row) => row.candidates?.source === 'smarter_api' && row.candidates.external_ref,
    )

    for (const row of eligible) {
      if (addedCount >= TARGET_READY_CANDIDATES) break
      try {
        await client.addCandidateToVacancy(vacancyId, row.candidates!.external_ref!)
        await supabase
          .from('job_candidates')
          .update({ smarter_recruiting_added_at: new Date().toISOString() })
          .eq('id', row.id)
        addedCount += 1
      } catch (error) {
        await logSystemEvent(supabase, {
          level: 'error',
          source: 'recruiter',
          eventType: 'partner_recruiting_application_failed',
          message: `Falha ao adicionar candidato à vaga "${job.title}" no parceiro ${client.partnerName}: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
          orgId: job.org_id,
          unitId: unit.id,
          metadata: { job_id: job.id, candidate_id: row.candidate_id },
        })
      }
    }

    if (addedCount > 0) {
      await logRecruiterEvent(supabase, {
        orgId: job.org_id,
        unitId: job.unit_id,
        jobId: job.id,
        eventType: 'partner_recruiting.candidates_added',
        message: `${addedCount}/${TARGET_READY_CANDIDATES} candidatos prontos na vaga do parceiro ${client.partnerName}.`,
        metadata: { added: addedCount, target: TARGET_READY_CANDIDATES },
      })
    }
  }

  if (addedCount >= TARGET_READY_CANDIDATES) return
  if (!SOURCING_ATTEMPTED_STATUSES.has(job.status)) return

  const notify = await shouldNotifyForEvent(supabase, {
    eventType: `partner_recruiting_low_${job.id}`,
    unitId: unit.id,
  })
  if (!notify) return

  await logDecision(supabase, {
    orgId: job.org_id,
    unitId: job.unit_id,
    jobId: job.id,
    decisionType: 'escalate',
    reasoning: `Busca esgotada com apenas ${addedCount} candidato(s) pronto(s) na vaga do parceiro ${client.partnerName} (meta: ${TARGET_READY_CANDIDATES}). Humano notificado.`,
    metadata: { added: addedCount, target: TARGET_READY_CANDIDATES },
  })

  let strategy: string | null = null
  if (addedCount === 0) {
    strategy = await generateSourcingStrategySuggestion(supabase, { job, unit, config })
  }

  await notifyOwnerOfLowPartnerPool(supabase, {
    job,
    unit,
    addedCount,
    partnerName: client.partnerName,
    strategy,
  })
}

async function generateSourcingStrategySuggestion(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; config: AgentConfig },
): Promise<string | null> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return null
  try {
    return await generateChatReply({
      apiKey,
      systemPrompt: buildSourcingStrategyPrompt(params),
      history: [{ role: 'user', content: 'Gere a sugestão de estratégia de captação.' }],
    })
  } catch (error) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'recruiter',
      eventType: 'sourcing_strategy_generation_failed',
      message: `Falha ao gerar sugestão de estratégia de captação: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      orgId: params.job.org_id,
      unitId: params.unit.id,
      metadata: { job_id: params.job.id },
    })
    return null
  }
}

async function notifyOwnerOfLowPartnerPool(
  supabase: SupabaseClient,
  params: { job: JobOpening; unit: Unit; addedCount: number; partnerName: string; strategy: string | null },
): Promise<void> {
  const { job, unit, addedCount, partnerName, strategy } = params

  await logSystemEvent(supabase, {
    level: 'warning',
    source: 'recruiter',
    eventType: `partner_recruiting_low_${job.id}`,
    message: `Vaga "${job.title}": só ${addedCount} candidato(s) pronto(s) na vaga do parceiro ${partnerName} (meta: ${TARGET_READY_CANDIDATES}).`,
    orgId: job.org_id,
    unitId: unit.id,
    metadata: { job_id: job.id, added: addedCount },
  })

  const ownerEmail = await getOwnerEmail(supabase, job.org_id)
  if (!ownerEmail) return

  await sendRecruiterEmail({
    to: ownerEmail,
    subject: `[${unit.name}] Vaga "${job.title}": poucos candidatos disponíveis no parceiro`,
    html: `
      <p>O Recruiter IA publicou a vaga <strong>${job.title}</strong> no sistema de vagas do parceiro (${partnerName}), mas só encontrou <strong>${addedCount}</strong> candidato(s) qualificado(s) para adicionar até agora (meta: ${TARGET_READY_CANDIDATES}).</p>
      ${
        strategy
          ? `<p><strong>Sugestão de estratégia de captação:</strong></p><p>${strategy}</p>`
          : '<p>Considere ampliar a divulgação da vaga ou revisar os requisitos com a empresa.</p>'
      }
    `,
  })
}

const POOL_MONITOR_WINDOW_HOURS = 24 * 7
const MONITORED_PAIRS_LIMIT = 10

/**
 * Monitoramento proativo (sem vaga aberta): olha os cursos/cidades que
 * esta unidade já recrutou recentemente (histórico de job_openings) e
 * sinaliza quando o banco de candidatos do parceiro está baixo para
 * eles — mesmo sem nenhuma vaga aberta no momento. Chamado 1x por
 * unidade pelo cron diário de reconciliação (mesmo padrão do refresh
 * noturno da Smarter em sourcing-engine.ts/cron/recruiter).
 */
export async function monitorPartnerCandidatePool(
  supabase: SupabaseClient,
  params: { unit: Unit; config: AgentConfig },
): Promise<void> {
  const { unit, config } = params
  const client = getPartnerRecruitingClient(unit)
  const orgId = unit.org_id
  if (!client || !orgId) {
    await warnIfMisconfigured(supabase, unit)
    return
  }

  const limits = getRecruiterLimits(config)

  const { data: jobRows } = await supabase
    .from('job_openings')
    .select('profile')
    .eq('unit_id', unit.id)
    .order('created_at', { ascending: false })
    .limit(50)

  const pairs = dedupeCourseCityPairs(((jobRows as { profile: JobProfile }[] | null) ?? []).map((row) => row.profile))
  if (pairs.length === 0) return

  for (const pair of pairs.slice(0, MONITORED_PAIRS_LIMIT)) {
    const available = await countAvailableCandidates(supabase, { orgId, course: pair.course, city: pair.city })
    if (available >= limits.sourcing_qualified_target) continue

    const key = `partner_recruiting_pool_low_${unit.id}_${pair.course ?? 'any'}_${pair.city ?? 'any'}`.replace(
      /\s+/g,
      '_',
    )
    const notify = await shouldNotifyForEvent(supabase, {
      eventType: key,
      unitId: unit.id,
      windowHours: POOL_MONITOR_WINDOW_HOURS,
    })
    if (!notify) continue

    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'recruiter',
      eventType: key,
      message: `Banco de candidatos do parceiro ${client.partnerName} está baixo para ${pair.course ?? 'qualquer curso'}${pair.city ? ` em ${pair.city}` : ''}: ${available} disponíveis (meta: ${limits.sourcing_qualified_target}).`,
      orgId,
      unitId: unit.id,
      metadata: { course: pair.course, city: pair.city, available, target: limits.sourcing_qualified_target },
    })

    const ownerEmail = await getOwnerEmail(supabase, orgId)
    if (!ownerEmail) continue

    await sendRecruiterEmail({
      to: ownerEmail,
      subject: `[${unit.name}] Banco de candidatos baixo: ${pair.course ?? 'geral'}${pair.city ? ` (${pair.city})` : ''}`,
      html: `
        <p>O Recruiter IA monitorou o banco de candidatos do parceiro (${client.partnerName}) para ${pair.course ?? 'qualquer curso'}${pair.city ? ` em ${pair.city}` : ''} e encontrou apenas <strong>${available}</strong> candidato(s) disponíveis (meta: ${limits.sourcing_qualified_target}).</p>
        <p>Vale considerar ações de captação nesta região/curso antes que uma nova vaga precise deles.</p>
      `,
    })
  }
}

function dedupeCourseCityPairs(profiles: JobProfile[]): { course: string | null; city: string | null }[] {
  const seen = new Set<string>()
  const pairs: { course: string | null; city: string | null }[] = []
  for (const profile of profiles) {
    const course = profile?.course ?? null
    const city = profile?.city ?? null
    if (!course && !city) continue
    const key = `${course}|${city}`
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push({ course, city })
  }
  return pairs
}
