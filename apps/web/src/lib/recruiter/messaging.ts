import type { SupabaseClient } from '@supabase/supabase-js'
import { getMessagingChannel, getUnitChannelType, channelLabel, type AttachmentToSend } from '@/lib/channels/messaging-channel'
import { sendRecruiterEmail } from '@/lib/email'
import { logSystemEvent } from '@/lib/system-events'
import type { AgentConfig, Unit } from '@/lib/types'
import { canContactCandidate, canSendNow, containsHiringPromise } from './guardrails'
import type { Candidate } from './types'

// Envio de mensagens do Recruiter com guard-rails aplicados em código
// (§11): horário ativo, limite diário compartilhado, opt-out/consent
// LGPD e filtro de promessa de contratação — tudo ANTES do envio.
// WhatsApp/SMS (conforme o canal configurado na unidade) preferido;
// fallback e-mail quando o destinatário tem e-mail (exceção 6 da spec).
// Toda mensagem fica registrada (candidate_messages para candidatos,
// conversations para a empresa/lead).

export type SendOutcome =
  | { sent: true; channel: 'whatsapp' | 'sms' | 'email' }
  | { sent: false; reason: string }

/** Envia mensagem a um candidato e registra em candidate_messages. */
export async function sendToCandidate(params: {
  supabase: SupabaseClient
  unit: Unit
  config: AgentConfig
  candidate: Candidate
  jobId: string | null
  text: string
  templateKey: string
  /** pula horário/limite (ex.: confirmação de opt-out é resposta imediata) */
  skipRateLimits?: boolean
  /** candidato mandou a mensagem por áudio → responde em áudio também (mesma mecânica do Sales Rep) */
  voiceReply?: boolean
  /** PDF da biblioteca de anexos (migration 036) a enviar de verdade junto — links já vêm embutidos em `text` por quem chama (ver screening-engine.ts). */
  attachment?: AttachmentToSend
}): Promise<SendOutcome> {
  const { supabase, unit, config, candidate, jobId, text, templateKey } = params

  const contactCheck = canContactCandidate(candidate)
  if (!contactCheck.ok) return { sent: false, reason: contactCheck.reason }

  if (containsHiringPromise(text)) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'recruiter',
      eventType: 'recruiter_promise_blocked',
      message: 'Mensagem gerada pela IA continha promessa de contratação e foi bloqueada antes do envio.',
      orgId: unit.org_id,
      unitId: unit.id,
      metadata: { candidate_id: candidate.id, job_id: jobId },
    })
    return { sent: false, reason: 'mensagem bloqueada pelo filtro de promessa de contratação' }
  }

  if (!params.skipRateLimits) {
    const sendCheck = await canSendNow(supabase, config, unit.id)
    if (!sendCheck.ok) return { sent: false, reason: sendCheck.reason }
  }

  const record = async (channel: 'whatsapp' | 'sms' | 'email', status: 'sent' | 'failed') => {
    await supabase.from('candidate_messages').insert({
      candidate_id: candidate.id,
      job_id: jobId,
      unit_id: unit.id,
      channel,
      direction: 'outbound',
      content: text,
      template_key: templateKey,
      status,
      sent_at: new Date().toISOString(),
    })
  }

  // Preferência WhatsApp/SMS (conforme o canal configurado na unidade)
  const channelType = getUnitChannelType(unit)
  const messagingChannel = getMessagingChannel(unit, supabase)
  if (messagingChannel && candidate.phone) {
    try {
      await messagingChannel.sendMessage(candidate.phone, text, { voiceReply: params.voiceReply, attachment: params.attachment })
      await record(channelType, 'sent')
      return { sent: true, channel: channelType }
    } catch (error) {
      await record(channelType, 'failed')
      await logSystemEvent(supabase, {
        level: 'error',
        source: channelType === 'sms' ? 'twilio' : 'evolution',
        eventType: 'recruiter_message_failed',
        message: `Falha ao enviar ${channelLabel(channelType)} a candidato: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        orgId: unit.org_id,
        unitId: unit.id,
        metadata: { candidate_id: candidate.id, job_id: jobId },
      })
      // cai para o fallback de e-mail abaixo
    }
  }

  if (candidate.email) {
    const result = await sendRecruiterEmail({
      to: candidate.email,
      subject: `${config.persona_name} — ${unit.name}`,
      html: `<p>${text.replace(/\n/g, '<br/>')}</p>`,
      attachment: params.attachment,
    })
    await record('email', result.ok ? 'sent' : 'failed')
    if (result.ok) return { sent: true, channel: 'email' }
    return { sent: false, reason: `${channelLabel(channelType)} e e-mail falharam: ${result.error ?? 'erro desconhecido'}` }
  }

  return {
    sent: false,
    reason: messagingChannel ? 'candidato sem telefone e sem e-mail alcançáveis' : `${channelLabel(channelType)} não configurado para esta unidade e candidato sem e-mail`,
  }
}

/** Envia mensagem à empresa (lead) e registra em conversations. */
export async function sendToCompany(params: {
  supabase: SupabaseClient
  unit: Unit
  config: AgentConfig
  leadId: string
  leadPhone: string | null
  leadEmail: string | null
  text: string
  templateKey: string
  skipRateLimits?: boolean
  /** empresa mandou a mensagem por áudio → responde em áudio também (mesma mecânica do Sales Rep) */
  voiceReply?: boolean
}): Promise<SendOutcome> {
  const { supabase, unit, config, leadId, text, templateKey } = params

  if (containsHiringPromise(text)) {
    return { sent: false, reason: 'mensagem bloqueada pelo filtro de promessa de contratação' }
  }

  if (!params.skipRateLimits) {
    const sendCheck = await canSendNow(supabase, config, unit.id)
    if (!sendCheck.ok) return { sent: false, reason: sendCheck.reason }
  }

  const record = async (channel: 'whatsapp' | 'sms' | 'email', status: 'sent' | 'failed') => {
    await supabase.from('conversations').insert({
      lead_id: leadId,
      unit_id: unit.id,
      channel,
      direction: 'outbound',
      content: text,
      template_key: templateKey,
      status,
      sent_at: new Date().toISOString(),
    })
  }

  const channelType = getUnitChannelType(unit)
  const messagingChannel = getMessagingChannel(unit, supabase)
  if (messagingChannel && params.leadPhone) {
    try {
      await messagingChannel.sendMessage(params.leadPhone, text, { voiceReply: params.voiceReply })
      await record(channelType, 'sent')
      return { sent: true, channel: channelType }
    } catch (error) {
      await record(channelType, 'failed')
      await logSystemEvent(supabase, {
        level: 'error',
        source: channelType === 'sms' ? 'twilio' : 'evolution',
        eventType: 'recruiter_message_failed',
        message: `Falha ao enviar ${channelLabel(channelType)} à empresa: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        orgId: unit.org_id,
        unitId: unit.id,
        leadId,
      })
    }
  }

  if (params.leadEmail) {
    const result = await sendRecruiterEmail({
      to: params.leadEmail,
      subject: `${config.persona_name} — ${unit.name}`,
      html: `<p>${text.replace(/\n/g, '<br/>')}</p>`,
    })
    await record('email', result.ok ? 'sent' : 'failed')
    if (result.ok) return { sent: true, channel: 'email' }
    return { sent: false, reason: `${channelLabel(channelType)} e e-mail falharam: ${result.error ?? 'erro desconhecido'}` }
  }

  return { sent: false, reason: 'empresa sem canal de contato alcançável' }
}
