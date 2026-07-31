import type { SupabaseClient } from '@supabase/supabase-js'
import { triggerFirstContact } from '@/lib/leads/lead-intake'
import { syncLeadToSmarterCrm } from '@/lib/sales/smarter-crm'
import { logSystemEvent } from '@/lib/system-events'
import type { Lead, Unit } from '@/lib/types'

// Entrada automática de lead de fonte externa (anúncios Meta/Google, ou
// qualquer outra origem que já tenha nome+telefone prontos, como o
// intake público por unidade) na fila do Sales Rep. Compartilhado por
// todos esses pontos de entrada para que o primeiro contato sempre use
// o mesmo motor de conversa configurado na entrevista de contratação
// (buildSystemPrompt + business_profile) em vez de uma mensagem fixa —
// e respeite os mesmos guard-rails (horário ativo, limite diário) que o
// resto do produto (lib/leads/lead-intake.ts).

export type AdLeadInput = {
  name: string | null
  phone: string | null
  email: string | null
  /** 'meta_lead_ad' | 'google_lead_ad' | 'smarter_landing_franquia' | 'smarter_site_publico' | ... */
  source: string
  notes?: string | null
  /**
   * id externo do lead no provedor de anúncio (leadgen_id do Meta, lead_id
   * do Google Ads). Meta e Google reentregam o webhook quando o handler não
   * responde 200 a tempo — sem checar este id antes de inserir, a reentrega
   * criaria um segundo lead e disparava um segundo primeiro contato pro
   * mesmo lead (mesmo padrão de risco de bloqueio já corrigido no webhook
   * do WhatsApp, ver commit 95d0d03). Reforçado por índice único no banco
   * (migration 050).
   */
  externalLeadId?: string | null
}

export async function createAdLead(
  supabase: SupabaseClient,
  params: { unit: Unit; lead: AdLeadInput },
): Promise<{ leadId: string; contacted: boolean } | null> {
  const { unit, lead: input } = params
  if (!input.phone) return null

  const normalizedPhone = input.phone.replace(/\D/g, '')
  if (!normalizedPhone) return null

  if (input.externalLeadId) {
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('unit_id', unit.id)
      .eq('source', input.source)
      .eq('external_lead_id', input.externalLeadId)
      .maybeSingle()
    if (existingLead) return null
  }

  const { data: insertedLead, error } = await supabase
    .from('leads')
    .insert({
      unit_id: unit.id,
      company_name: input.name ?? 'Lead',
      contact_name: input.name,
      phone: normalizedPhone,
      email: input.email,
      source: input.source,
      notes: input.notes ?? null,
      external_lead_id: input.externalLeadId ?? null,
      status: 'new',
    })
    .select()
    .single()

  if (error || !insertedLead) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'system',
      eventType: 'ad_lead_insert_failed',
      message: `Falha ao criar lead (${input.source}) na unidade "${unit.name}": ${error?.message ?? 'erro desconhecido'}`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
    return null
  }

  const leadRow = insertedLead as Lead
  await syncLeadToSmarterCrm(supabase, unit, leadRow)
  const contacted = await triggerFirstContact(supabase, unit, leadRow)
  return { leadId: leadRow.id, contacted }
}
