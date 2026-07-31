import type { SupabaseClient } from '@supabase/supabase-js'
import { getMessagingChannel, getEmailChannel, getUnitChannelType, channelLabel } from '@/lib/channels/messaging-channel'
import { generateFirstContactMessage, isWithinActiveHours, countSentToday, sendAcrossChannels } from '@/lib/conversation-engine'
import { ensureLeadEnrichment } from '@/lib/leads/enrichment'
import { logSystemEvent } from '@/lib/system-events'
import { syncLeadToSmarterCrm } from '@/lib/sales/smarter-crm'
import type { AgentConfig, Lead, Unit } from '@/lib/types'

/**
 * Fonte de prospecção fria automática (Google Maps, lib/prospecting/engine.ts)
 * — a única origem de lead que a empresa nunca convidou a conversar. Pra
 * não arriscar bloqueio do número de WhatsApp da unidade, o primeiro
 * contato desses leads sai SOMENTE por e-mail (nunca WhatsApp/SMS), mesmo
 * que o lead tenha telefone — a conversa só vira bidirecional quando o
 * lead responde ou clica no botão de WhatsApp do e-mail (ver
 * buildWhatsappCta abaixo), ou seja, sempre por iniciativa dele. Qualquer
 * outra origem (anúncio pago, intake público, CRM manual/import) já
 * envolveu alguma ação do lead ou de alguém com relação com ele, então
 * mantém o comportamento anterior (dual-channel).
 */
function isColdProspectingLead(lead: Pick<Lead, 'source'>): boolean {
  return lead.source === 'google_maps'
}

/**
 * Link wa.me pro número da própria unidade com uma mensagem pré-pronta que
 * o LEAD manda por conta própria — é isso que faz o primeiro toque real no
 * WhatsApp sempre partir do lead, nunca da unidade (item 2 do pedido).
 * Sem whatsapp_phone salvo (unidade nunca teve uma conexão confirmada) ou
 * sem Evolution configurada, devolve null e o e-mail sai sem o botão.
 */
function buildWhatsappCta(unit: Unit): { phone: string; text: string } | null {
  if (!unit.whatsapp_phone || !getMessagingChannel(unit)) return null
  return {
    phone: unit.whatsapp_phone,
    text: `Olá! Recebi o e-mail de ${unit.name} e quero saber mais.`,
  }
}

/**
 * Tenta o primeiro contato automático do Sales Rep com um lead recém-criado
 * (WhatsApp/SMS e e-mail, quando o lead tem os dois — ver sendAcrossChannels
 * — exceto prospecção fria, que é e-mail só, ver isColdProspectingLead),
 * respeitando os mesmos guard-rails usados em todo o produto (agente ativo,
 * horário ativo, limite diário). Compartilhado por todos os pontos de
 * entrada de lead novo — anúncios, intake genérico e criação manual pelo
 * CRM — para que o primeiro contato sempre use o mesmo motor de conversa
 * configurado na entrevista, em vez de mensagens fixas por canal, e para
 * que a criação manual pare de ficar parada em "novo" sem nunca ser
 * contatada. Antes de gerar a mensagem, pesquisa a empresa (Google Places
 * + website, ver lib/leads/enrichment.ts) para personalizar a abordagem —
 * na prospecção fria é essa mesma pesquisa que costuma achar o e-mail de
 * contato (leads do Google Maps só vêm com telefone).
 */
export async function triggerFirstContact(supabase: SupabaseClient, unit: Unit, lead: Lead): Promise<boolean> {
  const coldLead = isColdProspectingLead(lead)
  const emailChannelConfigured = Boolean(getEmailChannel(unit))
  const hasPhoneChannel = Boolean(lead.phone && getMessagingChannel(unit))
  const hasEmailChannel = Boolean(lead.email && emailChannelConfigured)

  if (coldLead) {
    // Ainda não se sabe se o lead tem e-mail (pode vir só da pesquisa
    // automática, abaixo) — o gate aqui é só "existe canal de e-mail
    // configurado na plataforma", nunca telefone.
    if (!emailChannelConfigured) return false
  } else if (!hasPhoneChannel && !hasEmailChannel) {
    return false
  }

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

    // Pesquisa não achou e-mail de contato: prospecção fria não tem para
    // onde mandar (nunca cai para WhatsApp/SMS), então não há primeiro
    // contato possível agora — o lead fica pendente para contato manual.
    if (coldLead && !enrichedLead.email) return false

    const message = await generateFirstContactMessage(config, unit, enrichedLead)
    if (!message) return false

    const { anySent } = await sendAcrossChannels({
      supabase,
      unit,
      // Prospecção fria: zera o telefone só nesta chamada de envio, para
      // que sendToLeadChannels nunca tente WhatsApp/SMS — o lead continua
      // com o telefone salvo normalmente em `leads.phone`.
      lead: coldLead ? { ...enrichedLead, phone: null } : enrichedLead,
      text: message,
      subject: `${config.persona_name} · ${unit.name}`,
      personaName: config.persona_name,
      templateKey: 'primeiro_contato',
      whatsappCta: coldLead ? buildWhatsappCta(unit) : null,
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
