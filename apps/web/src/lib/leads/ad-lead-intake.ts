import type { SupabaseClient } from '@supabase/supabase-js'
import { triggerFirstContact } from '@/lib/leads/lead-intake'
import { syncLeadToSmarterCrm } from '@/lib/sales/smarter-crm'
import { logSystemEvent } from '@/lib/system-events'
import type { Lead, Unit } from '@/lib/types'

// Entrada automática de leads de anúncio (Meta e Google Ads) na fila do
// Sales Rep (item 3). Compartilhado pelos dois webhooks para que o
// primeiro contato sempre use o mesmo motor de conversa configurado na
// entrevista de contratação (buildSystemPrompt + business_profile) em
// vez de uma mensagem fixa — e respeite os mesmos guard-rails (horário
// ativo, limite diário) que o resto do produto (lib/leads/lead-intake.ts).

export type AdLeadInput = {
  name: string | null
  phone: string | null
  email: string | null
  /** 'meta_lead_ad' | 'google_lead_ad' */
  source: string
}

export async function createAdLead(
  supabase: SupabaseClient,
  params: { unit: Unit; lead: AdLeadInput },
): Promise<{ leadId: string; contacted: boolean } | null> {
  const { unit, lead: input } = params
  if (!input.phone) return null

  const normalizedPhone = input.phone.replace(/\D/g, '')
  if (!normalizedPhone) return null

  const { data: insertedLead, error } = await supabase
    .from('leads')
    .insert({
      unit_id: unit.id,
      company_name: input.name ?? 'Lead de anúncio',
      contact_name: input.name,
      phone: normalizedPhone,
      email: input.email,
      source: input.source,
      status: 'new',
    })
    .select()
    .single()

  if (error || !insertedLead) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'system',
      eventType: 'ad_lead_insert_failed',
      message: `Falha ao criar lead de anúncio (${input.source}) na unidade "${unit.name}": ${error?.message ?? 'erro desconhecido'}`,
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
