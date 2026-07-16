import type { SupabaseClient } from '@supabase/supabase-js'
import { getMessagingChannel, getUnitChannelType, channelLabel } from '@/lib/channels/messaging-channel'
import { generateFirstContactMessage, isWithinActiveHours, countSentToday } from '@/lib/conversation-engine'
import { logSystemEvent } from '@/lib/system-events'
import { syncLeadToSmarterCrm } from '@/lib/sales/smarter-crm'
import type { AgentConfig, Lead, Unit } from '@/lib/types'

/**
 * Tenta o primeiro contato automático do Sales Rep com um lead recém-criado
 * (WhatsApp/SMS), respeitando os mesmos guard-rails usados em todo o
 * produto (agente ativo, horário ativo, limite diário). Compartilhado por
 * todos os pontos de entrada de lead novo — anúncios, intake genérico e
 * criação manual pelo CRM — para que o primeiro contato sempre use o mesmo
 * motor de conversa configurado na entrevista, em vez de mensagens fixas
 * por canal, e para que a criação manual pare de ficar parada em "novo"
 * sem nunca ser contatada.
 */
export async function triggerFirstContact(supabase: SupabaseClient, unit: Unit, lead: Lead): Promise<boolean> {
  if (!lead.phone) return false

  const { data: agentConfig } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('agent_type', 'sdr')
    .maybeSingle()

  const config = agentConfig as AgentConfig | null
  const channelType = getUnitChannelType(unit)
  const messagingChannel = getMessagingChannel(unit)

  if (!config?.is_active || !messagingChannel) return false
  if (!isWithinActiveHours(config.active_hours)) return false

  const sentToday = await countSentToday(supabase, unit.id)
  if (sentToday >= config.daily_limit) return false

  try {
    const message = await generateFirstContactMessage(config, unit, lead)
    if (!message) return false

    await messagingChannel.sendMessage(lead.phone, message)

    const sentAt = new Date().toISOString()
    await supabase.from('conversations').insert({
      lead_id: lead.id,
      unit_id: unit.id,
      channel: channelType,
      direction: 'outbound',
      content: message,
      status: 'sent',
      sent_at: sentAt,
    })
    await supabase.from('leads').update({ status: 'contacted', last_contacted_at: sentAt }).eq('id', lead.id)
    await syncLeadToSmarterCrm(
      supabase,
      unit,
      { ...lead, status: 'contacted', last_contacted_at: sentAt },
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
