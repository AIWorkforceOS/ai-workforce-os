import type { SupabaseClient } from '@supabase/supabase-js'
import { isRecruitmentDeal, isWithinActiveHours } from '@/lib/conversation-engine'
import { getRecruiterConfig } from '@/lib/recruiter/guardrails'
import { runSourcing } from '@/lib/recruiter/sourcing-engine'
import { logRecruiterEvent } from '@/lib/recruiter/log'
import { logSystemEvent } from '@/lib/system-events'
import type { AgentConfig, Lead, Unit } from '@/lib/types'
import type { JobOpening, JobProfile } from '@/lib/recruiter/types'

// Handoff Sales → Recrutador (item 2c): quando o Sales Rep (AI) fecha um
// negócio de verdade e já levantou os dados na própria conversa
// (conversation-engine.ts), a vaga é criada e enviada direto para o
// sourcing — sem passar pela etapa manual de "Abrir vaga" nem pelo
// intake assíncrono do Recrutador, que continua existindo para vagas
// abertas manualmente.
//
// Este handoff só faz sentido para negócios de recrutamento/estágio —
// o único vertical em que "fechar negócio" significa "preencher uma
// vaga". Para qualquer outro tipo de negócio (venda de produto/serviço
// etc., aprendido na entrevista via `fechamento_natureza`), fechar um
// negócio não deve criar vaga nenhuma: só registra o ganho.

function toStr(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function toNum(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** "quantidade de vagas" do fechamento vira o tamanho-alvo da shortlist (3-5, já usado por /api/jobs). */
function clampShortlistSize(value: unknown): number {
  const n = toNum(value)
  if (n === null) return 5
  return Math.min(5, Math.max(3, Math.round(n)))
}

/**
 * Ponto de entrada único do handoff de fechamento (chamado pelo webhook
 * do WhatsApp). Decide, a partir do que a empresa ensinou na entrevista
 * (`business_profile.fechamento_natureza`), se este fechamento é uma
 * vaga de recrutamento/estágio (cria job_opening e aciona o Recrutador)
 * ou um negócio genérico (só registra o ganho — sem inventar vaga nem
 * nenhuma outra automação para o vertical).
 */
export async function handleSalesDealHandoff(
  supabase: SupabaseClient,
  params: { leadId: string; unit: Unit },
): Promise<void> {
  const { leadId, unit } = params
  if (!unit.org_id) return

  const { data: leadRow } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle()
  const lead = leadRow as Lead | null
  if (!lead) return

  const { data: sdrConfigRow } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('agent_type', 'sdr')
    .maybeSingle()
  const sdrConfig = sdrConfigRow as AgentConfig | null
  const businessProfile = (sdrConfig?.business_profile ?? {}) as Record<string, unknown>

  if (!isRecruitmentDeal(businessProfile)) {
    await logSystemEvent(supabase, {
      level: 'info',
      source: 'sales',
      eventType: 'deal_won',
      message: `Sales Rep fechou negócio com "${lead.company_name}" — marcado como ganho (negócio não é de recrutamento/estágio, nenhuma vaga foi criada).`,
      orgId: unit.org_id,
      unitId: unit.id,
      leadId: lead.id,
    })
    return
  }

  // Idempotência: se já existe vaga criada por este fechamento (retry de
  // webhook, corrida entre mensagens), não duplica.
  const { data: existingJob } = await supabase
    .from('job_openings')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('source', 'sales_employee')
    .limit(1)
    .maybeSingle()
  if (existingJob) return

  const deal = (lead.deal_profile ?? {}) as Record<string, unknown>
  const profile: JobProfile = {
    course: toStr(deal.course),
    semester_min: toNum(deal.semester_min),
    semester_max: toNum(deal.semester_max),
    city: toStr(deal.city),
    modality: toStr(deal.modality),
  }
  const urgency = (['low', 'normal', 'high'] as const).includes(deal.urgency as 'low' | 'normal' | 'high')
    ? (deal.urgency as 'low' | 'normal' | 'high')
    : 'normal'

  const config = await getRecruiterConfig(supabase, unit.id)

  const { data: job, error } = await supabase
    .from('job_openings')
    .insert({
      org_id: unit.org_id,
      unit_id: unit.id,
      lead_id: lead.id,
      title: `Vaga — ${lead.company_name} (fechado pelo Sales Rep)`,
      status: config?.is_active ? 'profile_ready' : 'draft',
      profile,
      target_shortlist_size: clampShortlistSize(deal.positions_needed),
      urgency,
      source: 'sales_employee',
    })
    .select('*')
    .single()

  if (error || !job) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'recruiter',
      eventType: 'sales_handoff_job_creation_failed',
      message: `Fechamento do lead "${lead.company_name}" não conseguiu criar a vaga automaticamente: ${error?.message ?? 'erro desconhecido'}.`,
      orgId: unit.org_id,
      unitId: unit.id,
      leadId: lead.id,
    })
    return
  }

  const jobRow = job as JobOpening

  await logRecruiterEvent(supabase, {
    orgId: unit.org_id,
    unitId: unit.id,
    jobId: jobRow.id,
    eventType: 'job.created',
    message: `Vaga "${jobRow.title}" criada automaticamente pelo handoff do Sales Rep — perfil levantado na própria conversa de fechamento, sem intake manual.`,
  })

  if (!config || !config.is_active) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'recruiter',
      eventType: 'sales_handoff_recruiter_inactive',
      message: `Sales Rep fechou negócio com "${lead.company_name}" e criou a vaga "${jobRow.title}", mas o Recrutador está ${config ? 'inativo' : 'sem configuração'} — a vaga ficou como rascunho até ele ser ativado.`,
      orgId: unit.org_id,
      unitId: unit.id,
      leadId: lead.id,
    })
    return
  }

  if (!isWithinActiveHours(config.active_hours)) return // cron de reconciliação do Recrutador completa depois

  try {
    await runSourcing(supabase, { job: jobRow, unit, config })
  } catch (error) {
    console.error(
      `[sales_deal_handoff] sourcing inline falhou (cron reprocessa): ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
