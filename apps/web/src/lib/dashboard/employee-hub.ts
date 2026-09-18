import type { SupabaseClient } from '@supabase/supabase-js'
import type { HubAgentType } from '@/components/dashboard/employee-hub-gate'

export type EmployeeHubResolution = {
  /** existe pelo menos uma linha em agent_configs pra este agent_type (em alguma unidade da org) */
  hired: boolean
  /** pelo menos uma dessas linhas está is_active=true */
  active: boolean
  /** unidade usada pelas abas (Configurar/Materiais/Conexões) — da config escolhida, ou a 1ª unidade da org se ainda não foi contratado em nenhuma */
  unitId: string | null
  /** id do agent_configs escolhido — null se nunca contratado (esconde Treinar/Testar) */
  configId: string | null
}

type AgentConfigRow = { id: string; unit_id: string; is_active: boolean }

/**
 * Escolhe a config "principal" pra abas (Treinar/Testar/Configurar/
 * Materiais) quando a organização tem mais de uma unidade com este
 * funcionário contratado — prioriza uma ativa (é a que está de fato
 * trabalhando), senão a primeira contratada (pausada). Função pura,
 * separada de resolveEmployeeHub só pra ficar testável sem mockar Supabase.
 */
export function pickPrimaryAgentConfig<T extends AgentConfigRow>(configs: T[]): T | null {
  return configs.find((c) => c.is_active) ?? configs[0] ?? null
}

/**
 * Resolve o estado do funcionário pra um painel (/dashboard/agents,
 * /dashboard/recruiter etc.) — pedido do Vinicius (2026-09-18): cada
 * painel precisa saber se o funcionário já foi contratado/está ativo
 * (pro banner "o que fazer agora", ver EmployeeHubGate) e qual unidade
 * usar nas abas (ver EmployeeHubTabs). RLS de agent_configs/units já
 * escopa pra org certa — sem precisar filtrar org_id aqui.
 */
export async function resolveEmployeeHub(supabase: SupabaseClient, agentType: HubAgentType): Promise<EmployeeHubResolution> {
  const [{ data: configsData }, { data: unitsData }] = await Promise.all([
    supabase.from('agent_configs').select('id, unit_id, is_active').eq('agent_type', agentType),
    supabase.from('units').select('id').order('created_at', { ascending: true }).limit(1),
  ])
  const configs = (configsData ?? []) as AgentConfigRow[]
  const primary = pickPrimaryAgentConfig(configs)
  const fallbackUnitId = ((unitsData ?? [])[0] as { id: string } | undefined)?.id ?? null

  return {
    hired: configs.length > 0,
    active: configs.some((c) => c.is_active),
    unitId: primary?.unit_id ?? fallbackUnitId,
    configId: primary?.id ?? null,
  }
}
