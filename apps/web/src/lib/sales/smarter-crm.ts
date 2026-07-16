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

/** Tradução do status fixo do Alizo (leads.status) para o par etapa/situação fixo do CRM da Smarter. */
const LEAD_STATUS_TO_SMARTER: Record<LeadStatus, { etapa: SmarterCrmEtapa | null; situacao: SmarterCrmSituacao }> = {
  new: { etapa: 'novo_lead', situacao: 'ativo' },
  contacted: { etapa: 'primeiro_contato', situacao: 'ativo' },
  replied: { etapa: 'apresentacao', situacao: 'ativo' },
  negotiating: { etapa: 'negociacao', situacao: 'ativo' },
  won: { etapa: 'fechado', situacao: 'vendido' },
  lost: { etapa: null, situacao: 'perdido' },
  paused: { etapa: null, situacao: 'pausado' },
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
