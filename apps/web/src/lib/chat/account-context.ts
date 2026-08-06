import type { SupabaseClient } from '@supabase/supabase-js'
import { computeSetupStatus, unitHasWhatsapp, type UnitWhatsappChannelRow } from '@/lib/setup-status'
import type { AgentConfig, Unit } from '@/lib/types'

const AGENT_TYPE_LABEL: Record<string, string> = {
  sdr: 'Sales Rep',
  receptionist: 'AI Receptionist',
  recruiter: 'Recrutador',
  traffic_specialist: 'Gestor de Tráfego',
  content_specialist: 'Gestor de Conteúdo',
  seo_specialist: 'Especialista em SEO',
}

const INTERVIEW_STATUS_LABEL: Record<string, string> = {
  pending: 'entrevista pendente',
  in_progress: 'entrevista em andamento',
  completed: 'entrevista concluída',
}

type AdAccountRow = { connection_status: string }
type SocialAccountRow = { connection_status: string }

/**
 * Monta um resumo compacto (texto simples, não JSON) do estado real da conta
 * do cliente logado — unidades, WhatsApp, funcionários contratados, contas de
 * anúncio/social — pra injetar no system prompt do chat e a Kai parar de dar
 * respostas genéricas pra quem já tem contexto disponível no banco.
 *
 * Best-effort: cada busca é isolada: se uma falhar, o pedaço correspondente
 * some do resumo em vez de derrubar o chat inteiro. Quando chamado com o
 * client de sessão autenticada do dashboard (Kai), RLS já escopa tudo à org
 * do usuário e `orgId` pode ficar de fora. Mas o Funcionário TI interno
 * (lib/ti/engine.ts) reusa esta função a partir de um client service-role
 * (fluxo de webhook, sem RLS) — ali `orgId` é obrigatório na prática, senão
 * o resumo vazaria dados de TODAS as orgs. `agent_configs` não tem coluna
 * org_id própria, então é filtrada em memória pelas unidades já restritas.
 */
export async function buildAccountContext(supabase: SupabaseClient, orgId?: string | null): Promise<string | null> {
  let unitsQuery = supabase.from('units').select('id, name, whatsapp_phone, is_active').order('created_at', { ascending: true })
  let whatsappChannelsQuery = supabase.from('unit_whatsapp_channels').select('unit_id, agent_type, whatsapp_phone')
  let adAccountsQuery = supabase.from('ad_accounts').select('connection_status')
  let socialAccountsQuery = supabase.from('social_accounts').select('connection_status')
  if (orgId) {
    unitsQuery = unitsQuery.eq('org_id', orgId)
    whatsappChannelsQuery = whatsappChannelsQuery.eq('org_id', orgId)
    adAccountsQuery = adAccountsQuery.eq('org_id', orgId)
    socialAccountsQuery = socialAccountsQuery.eq('org_id', orgId)
  }

  const [unitsResult, agentConfigsResult, whatsappChannelsResult, adAccountsResult, socialAccountsResult] = await Promise.allSettled([
    unitsQuery,
    supabase.from('agent_configs').select('unit_id, agent_type, persona_name, is_active, interview_status'),
    whatsappChannelsQuery,
    adAccountsQuery,
    socialAccountsQuery,
  ])

  const units = extractRows<Pick<Unit, 'id' | 'name' | 'whatsapp_phone' | 'is_active'>>(unitsResult, 'units')
  let agentConfigs = extractRows<
    Pick<AgentConfig, 'unit_id' | 'agent_type' | 'persona_name' | 'is_active' | 'interview_status'>
  >(agentConfigsResult, 'agent_configs')
  const whatsappChannels = extractRows<UnitWhatsappChannelRow>(whatsappChannelsResult, 'unit_whatsapp_channels') ?? []
  const adAccounts = extractRows<AdAccountRow>(adAccountsResult, 'ad_accounts')
  const socialAccounts = extractRows<SocialAccountRow>(socialAccountsResult, 'social_accounts')

  if (orgId && units && agentConfigs) {
    const unitIds = new Set(units.map((u) => u.id))
    agentConfigs = agentConfigs.filter((c) => unitIds.has(c.unit_id))
  }

  const sections: string[] = []

  if (units) {
    if (units.length === 0) {
      sections.push('Unidades: nenhuma cadastrada ainda.')
    } else {
      const unitLines = units.map((u) => {
        const status = unitHasWhatsapp(u, whatsappChannels, 'sdr') ? 'WhatsApp conectado' : 'WhatsApp NÃO conectado'
        return `- ${u.name}${u.is_active ? '' : ' (inativa)'}: ${status}`
      })
      sections.push(`Unidades (${units.length}):\n${unitLines.join('\n')}`)
    }
  }

  if (agentConfigs) {
    if (agentConfigs.length === 0) {
      sections.push('Funcionários digitais: nenhum contratado ainda.')
    } else {
      const configLines = agentConfigs.map((c) => {
        const label = AGENT_TYPE_LABEL[c.agent_type] ?? c.agent_type
        const activeLabel = c.is_active ? 'ativo' : 'contratado mas ainda não ativado'
        const interviewLabel = c.interview_status ? INTERVIEW_STATUS_LABEL[c.interview_status] ?? c.interview_status : null
        const extra = interviewLabel ? `, ${interviewLabel}` : ''
        return `- ${label} ("${c.persona_name}"): ${activeLabel}${extra}`
      })
      sections.push(`Funcionários digitais:\n${configLines.join('\n')}`)
    }
  }

  if (adAccounts) {
    sections.push(adAccounts.length === 0 ? 'Contas de anúncio: nenhuma conectada.' : `Contas de anúncio: ${summarizeStatuses(adAccounts)}.`)
  }

  if (socialAccounts) {
    sections.push(
      socialAccounts.length === 0
        ? 'Contas de rede social (Instagram/Facebook): nenhuma conectada.'
        : `Contas de rede social (Instagram/Facebook): ${summarizeStatuses(socialAccounts)}.`,
    )
  }

  if (units && agentConfigs) {
    const setup = computeSetupStatus(units, agentConfigs, whatsappChannels)
    if (setup.nextAction) {
      sections.push(`Próximo passo pendente do cliente: ${setup.nextAction.label} (${setup.nextAction.description})`)
    }
  }

  if (sections.length === 0) return null

  return `CONTEXTO REAL DA CONTA DO CLIENTE LOGADO (use isso pra responder de forma específica, não genérica):\n${sections.join('\n\n')}`
}

function extractRows<T>(
  result: PromiseSettledResult<{ data: unknown; error: unknown }>,
  label: string,
): T[] | null {
  if (result.status === 'rejected') {
    console.error(`[chat account-context] falha ao buscar ${label}:`, result.reason)
    return null
  }
  if (result.value.error) {
    console.error(`[chat account-context] erro ao buscar ${label}:`, result.value.error)
    return null
  }
  return (result.value.data as T[] | null) ?? []
}

function summarizeStatuses(rows: { connection_status: string }[]): string {
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.connection_status, (counts.get(row.connection_status) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([status, count]) => `${count} ${statusLabel(status)}`)
    .join(', ')
}

function statusLabel(status: string): string {
  switch (status) {
    case 'connected':
      return 'conectada(s)'
    case 'pending_credentials':
      return 'pendente(s) de credenciais'
    case 'error':
      return 'com erro'
    case 'disconnected':
      return 'desconectada(s)'
    default:
      return status
  }
}
