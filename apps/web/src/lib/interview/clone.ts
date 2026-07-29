import type { InterviewAgentType } from '@/lib/interview/engine'
import type { AgentConfig, ProspectingProfile } from '@/lib/types'

// Clonar treinamento entre unidades da mesma org (ex.: franquias que vendem
// exatamente o mesmo produto/serviço, só mudando a região onde atuam) — em
// vez de repetir a entrevista adaptativa inteira do zero pra cada unidade
// nova. Ver EmployeeCatalog (components/dashboard/employee-catalog.tsx).
//
// Só entra aqui quem a UI já filtrou como elegível: config de ORIGEM com
// interview_status='completed' (nunca clona um treinamento incompleto).

/**
 * Caminho, dentro do business_profile de cada tipo de agente, onde mora a
 * "região de atuação" (ver profileSchema em INTERVIEW_PLAYBOOKS, lib/interview/engine.ts).
 * Tipos sem um campo de região no schema (receptionist, content_specialist)
 * simplesmente não têm o valor sobrescrito — o resto do perfil ainda é clonado.
 */
function applyRegionOverride(
  agentType: InterviewAgentType,
  profile: Record<string, unknown>,
  region: string,
): Record<string, unknown> {
  const trimmed = region.trim()
  if (!trimmed) return profile

  switch (agentType) {
    case 'sdr': {
      const prospeccao = (profile.prospeccao as Record<string, unknown> | undefined) ?? {}
      return { ...profile, prospeccao: { ...prospeccao, regioes: [trimmed] } }
    }
    case 'traffic_specialist':
      return { ...profile, regiao: trimmed }
    case 'seo_specialist':
      return { ...profile, regiao_atuacao: trimmed }
    case 'recruiter':
      return { ...profile, locais: [trimmed] }
    case 'receptionist':
    case 'content_specialist':
      return profile
  }
}

export type ClonedAgentConfigFields = {
  persona_tone: AgentConfig['persona_tone']
  daily_limit: number
  active_hours: AgentConfig['active_hours']
  escalation_rules: AgentConfig['escalation_rules']
  sectors: AgentConfig['sectors']
  business_profile: Record<string, unknown>
  prospecting_profile: ProspectingProfile
  interview_status: 'completed'
  interview_transcript: AgentConfig['interview_transcript']
  training_corrections: AgentConfig['training_corrections']
  last_trained_at: string
}

/**
 * Monta os campos a gravar no agent_config de DESTINO a partir do de ORIGEM,
 * com a região de atuação já substituída. Função pura — quem chama decide
 * se isso vira um insert (unidade ainda não tinha esse funcionário) ou um
 * update (unidade já tinha, e o dono escolheu substituir pelo clone).
 */
export function buildClonedAgentConfig(params: {
  source: AgentConfig
  region: string
  now?: Date
}): ClonedAgentConfigFields {
  const { source, region, now = new Date() } = params
  const agentType = source.agent_type as InterviewAgentType
  const sourceProfile = (source.business_profile ?? {}) as Record<string, unknown>
  const sourceProspecting: ProspectingProfile = source.prospecting_profile ?? {}
  const trimmedRegion = region.trim()

  return {
    persona_tone: source.persona_tone,
    daily_limit: source.daily_limit,
    active_hours: source.active_hours,
    escalation_rules: source.escalation_rules,
    sectors: source.sectors,
    business_profile: applyRegionOverride(agentType, sourceProfile, region),
    prospecting_profile: trimmedRegion ? { ...sourceProspecting, region: trimmedRegion } : sourceProspecting,
    interview_status: 'completed',
    interview_transcript: source.interview_transcript,
    training_corrections: source.training_corrections,
    last_trained_at: now.toISOString(),
  }
}
