import type { SupabaseClient } from '@supabase/supabase-js'
import { logSystemEvent } from '@/lib/system-events'
import type { Lead, LeadStatus, Unit } from '@/lib/types'

// Cliente do CRM de parceiros da Smarter (§ contrato POST/PATCH
// /api/partners/leads no Sistema Smarter).
//
// FRONTEIRA EXPLÍCITA: mesma regra de isolamento de lib/recruiter/smarter-api.ts
// — a Smarter é tratada como fornecedora/consumidora externa via API HTTP
// autorizada por token de parceiro DA UNIDADE (units.smarter_crm_partner_token),
// nunca acesso direto a banco/código do Sistema Smarter (regra do CLAUDE.md).
//
// Ativado por unidade via units.crm_integration_mode = 'smarter' +
// units.smarter_crm_partner_token — não há detecção automática por tipo de
// negócio. Quando o modo é 'native' (padrão) ou o token está ausente, este
// módulo não faz nenhuma chamada.

const SMARTER_CRM_API_BASE =
  process.env.SMARTER_CRM_API_URL ?? 'https://sistema.smarterestagios.com.br/api/partners/leads'

export type SmarterCrmEtapa =
  | 'novo_lead'
  | 'primeiro_contato'
  | 'apresentacao'
  | 'proposta'
  | 'negociacao'
  | 'fechado'
export type SmarterCrmSituacao = 'ativo' | 'vendido' | 'perdido' | 'pausado'
export type SmarterCrmPrioridade = 'baixa' | 'media' | 'alta'

/** Shape esperado do contrato de parceria (campos ausentes são tolerados). */
export type SmarterCrmLead = { id: string; [key: string]: unknown }

export type CreateSmarterCrmLeadInput = {
  empresa: string
  contato: string
  email?: string | null
  telefone?: string | null
  whatsapp?: string | null
  instagram?: string | null
  linkedin?: string | null
  cidade?: string | null
  uf?: string | null
  setor?: string | null
  origem?: string | null
  prioridade?: SmarterCrmPrioridade
  anotacao?: string | null
  valorNegociado?: number | null
}

export type UpdateSmarterCrmLeadInput = Partial<{
  etapa: SmarterCrmEtapa
  situacao: SmarterCrmSituacao
  proximaAcao: string | null
  valorNegociado: number | null
  anotacao: string | null
}>

async function smarterCrmRequest(
  method: 'POST' | 'PATCH',
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<SmarterCrmLead> {
  const response = await fetch(`${SMARTER_CRM_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message = data?.error ?? data?.message ?? `API de CRM da Smarter retornou status ${response.status}`
    throw new Error(Array.isArray(message) ? message.join(', ') : String(message))
  }
  if (!data?.id) throw new Error('API de CRM da Smarter não retornou o id do lead.')
  return data as SmarterCrmLead
}

export async function createSmarterCrmLead(
  token: string,
  input: CreateSmarterCrmLeadInput,
): Promise<SmarterCrmLead> {
  return smarterCrmRequest('POST', '', token, input)
}

export async function updateSmarterCrmLead(
  token: string,
  smarterLeadId: string,
  input: UpdateSmarterCrmLeadInput,
): Promise<SmarterCrmLead> {
  return smarterCrmRequest('PATCH', `/${smarterLeadId}`, token, input)
}

// ── CRM de Franquias (leads de quem quer abrir uma franquia Smarter) ──────
//
// Endpoint DIFERENTE do CRM acima: /api/partners/franquia-leads, não
// /api/partners/leads. Escopo de token "franquia_crm", nível REDE — não
// pertence a nenhuma franquia/unidade da Smarter (FranquiaLead é da
// franqueadora como um todo), autorizado por SMARTER_FRANQUIA_CRM_TOKEN
// (env var global, não units.smarter_crm_partner_token). Ver diagnóstico
// de 2026-08-14: até então só existia o caminho Alizo→Smarter (acima);
// este é o primeiro caminho de leitura (Smarter→Alizo).

const SMARTER_FRANQUIA_CRM_API_BASE =
  process.env.SMARTER_FRANQUIA_CRM_API_URL ?? 'https://sistema.smarterestagios.com.br/api/partners/franquia-leads'

export type FranquiaCrmEtapa =
  | 'novo_lead'
  | 'primeiro_contato'
  | 'apresentacao'
  | 'due_diligence'
  | 'proposta'
  | 'fechado'
export type FranquiaCrmSituacao = 'ativo' | 'vendido' | 'perdido'

export type FranquiaCrmLead = {
  id: string
  nomeCompleto: string
  email: string | null
  telefone: string | null
  cidade: string | null
  estado: string | null
  etapa: FranquiaCrmEtapa
  situacao: FranquiaCrmSituacao
  origem: string | null
  leadFrio: boolean
  optIn: boolean
  ultimoContato: string | null
  proximaAcao: string | null
  createdAt: string
  ultimaNota: { texto: string; tipo: string; createdAt: string } | null
}

export type ListFranquiaCrmLeadsResult = {
  leads: FranquiaCrmLead[]
  pagination: { hasMore: boolean; nextCursor: string | null }
}

/**
 * GET /api/partners/franquia-leads — lista leads do CRM de Franquias.
 * `stale: true` filtra só situacao=ativo com ultimoContato nulo/antigo —
 * é o caso de uso real (376 leads parados, 375 nunca contatados).
 */
export async function listFranquiaCrmLeads(
  token: string,
  opts: { stale?: boolean; cursor?: string; limit?: number } = {},
): Promise<ListFranquiaCrmLeadsResult> {
  const params = new URLSearchParams()
  if (opts.stale) params.set('stale', 'true')
  if (opts.cursor) params.set('cursor', opts.cursor)
  if (opts.limit) params.set('limit', String(opts.limit))
  const qs = params.toString()

  const response = await fetch(`${SMARTER_FRANQUIA_CRM_API_BASE}${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message = data?.message ?? `API de CRM de Franquias da Smarter retornou status ${response.status}`
    throw new Error(String(message))
  }
  if (!data?.success || !Array.isArray(data?.data?.leads)) {
    throw new Error('API de CRM de Franquias da Smarter retornou um formato inesperado.')
  }
  return data.data as ListFranquiaCrmLeadsResult
}

export type UpdateFranquiaCrmLeadInput = Partial<{
  etapa: FranquiaCrmEtapa
  situacao: FranquiaCrmSituacao
  proximaAcao: string | null
  anotacao: string | null
  contatoRealizado: boolean
}>

/**
 * PATCH /api/partners/franquia-leads/[id] — registra contato/atualização
 * de volta no CRM de Franquias, pra não confundir o time humano da Smarter
 * que também pode estar trabalhando o mesmo lead.
 */
export async function updateFranquiaCrmLead(
  token: string,
  franquiaLeadId: string,
  input: UpdateFranquiaCrmLeadInput,
): Promise<FranquiaCrmLead> {
  const response = await fetch(`${SMARTER_FRANQUIA_CRM_API_BASE}/${franquiaLeadId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(input),
    cache: 'no-store',
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message = data?.message ?? `API de CRM de Franquias da Smarter retornou status ${response.status}`
    throw new Error(String(message))
  }
  if (!data?.lead?.id) throw new Error('API de CRM de Franquias da Smarter não retornou o lead atualizado.')
  return data.lead as FranquiaCrmLead
}

export function getSmarterFranquiaCrmToken(): string | null {
  return process.env.SMARTER_FRANQUIA_CRM_TOKEN || null
}

export function getSmarterFranquiaCrmUnitId(): string | null {
  return process.env.SMARTER_FRANQUIA_CRM_UNIT_ID || null
}

/** Tradução do status fixo do Alizo (leads.status) para o par etapa/situação fixo do CRM da Smarter. */
const LEAD_STATUS_TO_SMARTER: Record<LeadStatus, { etapa: SmarterCrmEtapa | null; situacao: SmarterCrmSituacao }> = {
  new: { etapa: 'novo_lead', situacao: 'ativo' },
  // Claim atômico transitório (lib/leads/lead-intake.ts) — nunca deveria
  // chegar aqui de fato (o sync final sempre usa status já resolvido para
  // 'contacted' ou 'new'), mas precisa de um mapeamento por exaustividade.
  contacting: { etapa: 'novo_lead', situacao: 'ativo' },
  contacted: { etapa: 'primeiro_contato', situacao: 'ativo' },
  replied: { etapa: 'apresentacao', situacao: 'ativo' },
  negotiating: { etapa: 'negociacao', situacao: 'ativo' },
  won: { etapa: 'fechado', situacao: 'vendido' },
  lost: { etapa: null, situacao: 'perdido' },
  paused: { etapa: null, situacao: 'pausado' },
  // Nunca deveria sincronizar pro CRM de Vendas (CrmLead) — leads com esse
  // status vieram DO outro CRM (Franquias), não vão pra ele. Mapeamento só
  // por exaustividade do Record<LeadStatus, ...>.
  imported_pending_review: { etapa: 'novo_lead', situacao: 'ativo' },
}

/**
 * Ponto de entrada único da sincronização com o CRM da Smarter: cria o
 * lead lá na primeira vez (POST) e faz PATCH nas mudanças relevantes
 * seguintes, correlacionando por leads.smarter_crm_lead_id. No-op quando a
 * unidade não está no modo 'smarter' ou não tem token configurado. Nunca
 * lança — uma falha aqui não pode quebrar a conversa do Sales Rep, só fica
 * registrada em system_events para o time humano perceber.
 */
export async function syncLeadToSmarterCrm(
  supabase: SupabaseClient,
  unit: Unit,
  lead: Lead,
  opts: { statusChanged?: boolean; notesChanged?: boolean } = {},
): Promise<string | null> {
  if (unit.crm_integration_mode !== 'smarter' || !unit.smarter_crm_partner_token) {
    return lead.smarter_crm_lead_id
  }

  try {
    if (!lead.smarter_crm_lead_id) {
      const created = await createSmarterCrmLead(unit.smarter_crm_partner_token, {
        empresa: lead.company_name,
        contato: lead.contact_name ?? lead.company_name,
        email: lead.email,
        telefone: lead.phone,
        whatsapp: lead.phone,
        cidade: lead.city,
        uf: lead.state,
        setor: lead.sector,
        origem: lead.source,
        anotacao: lead.notes,
      })
      await supabase.from('leads').update({ smarter_crm_lead_id: created.id }).eq('id', lead.id)
      return created.id
    }

    const patch: UpdateSmarterCrmLeadInput = {}
    if (opts.statusChanged) {
      const mapping = LEAD_STATUS_TO_SMARTER[lead.status]
      if (mapping.etapa) patch.etapa = mapping.etapa
      patch.situacao = mapping.situacao
    }
    if (opts.notesChanged && lead.notes) patch.anotacao = lead.notes
    if (Object.keys(patch).length === 0) return lead.smarter_crm_lead_id

    await updateSmarterCrmLead(unit.smarter_crm_partner_token, lead.smarter_crm_lead_id, patch)
    return lead.smarter_crm_lead_id
  } catch (error) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'smarter_crm',
      eventType: lead.smarter_crm_lead_id ? 'smarter_crm_update_failed' : 'smarter_crm_create_failed',
      message: `Falha ao sincronizar lead "${lead.company_name}" com o CRM da Smarter: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      orgId: unit.org_id,
      unitId: unit.id,
      leadId: lead.id,
    })
    return lead.smarter_crm_lead_id
  }
}
