import type { SupabaseClient } from '@supabase/supabase-js'
import { getEvolutionConfig, sendWhatsAppMessage } from '@/lib/evolution'
import { generateFirstContactMessage, isWithinActiveHours, countSentToday } from '@/lib/conversation-engine'
import { logSystemEvent } from '@/lib/system-events'
import type { AgentConfig, Lead, Unit } from '@/lib/types'

// Entrada automática de leads de anúncio (Meta e Google Ads) na fila do
// Sales Rep (item 3). Compartilhado pelos dois webhooks para que o
// primeiro contato sempre use o mesmo motor de conversa configurado na
// entrevista de contratação (buildSystemPrompt + business_profile) em
// vez de uma mensagem fixa — e respeite os mesmos guard-rails (horário
// ativo, limite diário) que o resto do produto.

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

  const { data: agentConfig } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('agent_type', 'sdr')
    .maybeSingle()

  const config = agentConfig as AgentConfig | null
  const evolutionConfig = getEvolutionConfig(unit)

  if (!config?.is_active || !evolutionConfig) {
    return { leadId: leadRow.id, contacted: false }
  }
  if (!isWithinActiveHours(config.active_hours)) {
    return { leadId: leadRow.id, contacted: false }
  }
  const sentToday = await countSentToday(supabase, unit.id)
  if (sentToday >= config.daily_limit) {
    return { leadId: leadRow.id, contacted: false }
  }

  try {
    const message = await generateFirstContactMessage(config, unit, leadRow)
    if (!message) return { leadId: leadRow.id, contacted: false }

    await sendWhatsAppMessage(evolutionConfig, normalizedPhone, message)

    const sentAt = new Date().toISOString()
    await supabase.from('conversations').insert({
      lead_id: leadRow.id,
      unit_id: unit.id,
      channel: 'whatsapp',
      direction: 'outbound',
      content: message,
      status: 'sent',
      sent_at: sentAt,
    })
    await supabase.from('leads').update({ status: 'contacted', last_contacted_at: sentAt }).eq('id', leadRow.id)
    return { leadId: leadRow.id, contacted: true }
  } catch (error) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'evolution',
      eventType: 'ad_lead_first_contact_failed',
      message: `Lead de anúncio criado na unidade "${unit.name}" mas a primeira mensagem falhou: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      orgId: unit.org_id,
      unitId: unit.id,
      leadId: leadRow.id,
    })
    return { leadId: leadRow.id, contacted: false }
  }
}
