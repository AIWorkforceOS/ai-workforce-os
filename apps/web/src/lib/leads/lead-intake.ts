import type { SupabaseClient } from '@supabase/supabase-js'
import { getMessagingChannel, getEmailChannel, getUnitChannelType, channelLabel } from '@/lib/channels/messaging-channel'
import { generateFirstContactMessage, isWithinActiveHours, countSentToday, sendAcrossChannels } from '@/lib/conversation-engine'
import { ensureLeadEnrichment } from '@/lib/leads/enrichment'
import { logSystemEvent } from '@/lib/system-events'
import { syncLeadToSmarterCrm } from '@/lib/sales/smarter-crm'
import type { AgentConfig, Lead, Unit } from '@/lib/types'

/**
 * Tenta o primeiro contato automático do Sales Rep com um lead recém-criado
 * (WhatsApp/SMS e e-mail, quando o lead tem os dois — ver sendAcrossChannels),
 * respeitando os mesmos guard-rails usados em todo o produto (agente ativo,
 * horário ativo, limite diário). Compartilhado por todos os pontos de
 * entrada de lead novo — anúncios, intake genérico e criação manual pelo
 * CRM — para que o primeiro contato sempre use o mesmo motor de conversa
 * configurado na entrevista, em vez de mensagens fixas por canal, e para
 * que a criação manual pare de ficar parada em "novo" sem nunca ser
 * contatada. Antes de gerar a mensagem, pesquisa a empresa (Google Places
 * + website, ver lib/leads/enrichment.ts) para personalizar a abordagem.
 */
export async function triggerFirstContact(supabase: SupabaseClient, unit: Unit, lead: Lead): Promise<boolean> {
  const hasPhoneChannel = Boolean(lead.phone && getMessagingChannel(unit))
  const hasEmailChannel = Boolean(lead.email && getEmailChannel(unit))
  if (!hasPhoneChannel && !hasEmailChannel) return false

  const { data: agentConfig } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('agent_type', 'sdr')
    .maybeSingle()

  const config = agentConfig as AgentConfig | null
  const channelType = getUnitChannelType(unit)

  if (!config?.is_active) return false
  if (!isWithinActiveHours(config.active_hours)) return false

  const sentToday = await countSentToday(supabase, unit.id)
  if (sentToday >= config.daily_limit) return false

  try {
    const enrichedLead = await ensureLeadEnrichment(supabase, lead)

    const message = await generateFirstContactMessage(config, unit, enrichedLead)
    if (!message) return false

    const { anySent } = await sendAcrossChannels({
      supabase,
      unit,
      lead: enrichedLead,
      text: message,
      subject: `${config.persona_name} · ${unit.name}`,
      personaName: config.persona_name,
      templateKey: 'primeiro_contato',
    })
    if (!anySent) return false

    const sentAt = new Date().toISOString()
    await supabase.from('leads').update({ status: 'contacted', last_contacted_at: sentAt }).eq('id', lead.id)
    await syncLeadToSmarterCrm(
      supabase,
      unit,
      { ...enrichedLead, status: 'contacted', last_contacted_at: sentAt },
      { statusChanged: true },
    )
    return true
  } catch (error) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: channelType === 'sms' ? 'twilio' : 'evolution',
      eventType: 'lead_first_contact_failed',
      message: `Lead "${lead.company_name}" criado na unidade "${unit.name}" mas a primeira mensagem (${channelLabel(channelType)}) falhou: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      orgId: unit.org_id,
      unitId: unit.id,
      leadId: lead.id,
    })
    return false
  }
}
