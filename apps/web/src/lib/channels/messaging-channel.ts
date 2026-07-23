import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConversationChannel, Lead, MessagingChannelType, Unit } from '@/lib/types'
import {
  getEvolutionConfig,
  sendRecordingPresence,
  sendTypingPresence,
  sendWhatsAppAudio,
  sendWhatsAppDocument,
  sendWhatsAppMessage,
  type EvolutionUnitConfig,
} from '@/lib/evolution'
import { getTwilioConfig, sendSmsMessage, type TwilioUnitConfig } from '@/lib/twilio'
import { getResendApiKey, sendLeadEmail } from '@/lib/email'
import { computeHumanTypingDelayMs, sleep } from '@/lib/humanized-timing'
import { getOpenAIApiKey, synthesizeSpeech } from '@/lib/openai'
import { logOpenAITtsUsage } from '@/lib/api-usage'
import { logSystemEvent } from '@/lib/system-events'

// Abstração de canal de mensagens (item 1): o funcionário de IA (SDR,
// Sales Rep, Recruiter) fala com o cliente por WhatsApp (Evolution API),
// SMS (Twilio, para países como os EUA onde WhatsApp não é o canal
// dominante) ou e-mail (Resend) sem precisar saber qual está por trás —
// só chama sendMessage. WhatsApp/SMS são o canal "de telefone" da
// unidade (escolhido em units.messaging_channel via getUnitChannelType);
// e-mail é sempre adicional — tentado sempre que o lead tem endereço
// cadastrado, em paralelo ao canal de telefone (ver sendToLeadChannels).

export type ChannelType = ConversationChannel

/** PDF da biblioteca de anexos (migration 036) a enviar junto com a resposta — nunca aparece aqui pra `kind: 'link'` nem no canal SMS, que já embutem a URL no texto (ver processInboundMessage em lib/conversation-engine.ts). */
export type AttachmentToSend = { title: string; url: string; fileName?: string | null }

export type SendContext = {
  subject?: string
  personaName?: string
  /** Espelha a modalidade: cliente mandou áudio → responde em áudio (só WhatsApp — ver item 7 do pedido). */
  voiceReply?: boolean
  attachment?: AttachmentToSend
}

export interface MessagingChannel {
  readonly type: ChannelType
  sendMessage(recipient: string, text: string, context?: SendContext): Promise<void>
}

class EvolutionWhatsAppChannel implements MessagingChannel {
  readonly type: ChannelType = 'whatsapp'

  constructor(
    private readonly config: EvolutionUnitConfig,
    private readonly unit: Unit,
    private readonly supabase: SupabaseClient | null,
  ) {}

  async sendMessage(phone: string, text: string, context?: SendContext): Promise<void> {
    let sentAsVoice = false
    if (context?.voiceReply) {
      sentAsVoice = await this.trySendVoice(phone, text)
    }
    if (!sentAsVoice) {
      await this.sendText(phone, text)
    }
    if (context?.attachment) {
      await this.trySendDocument(phone, context.attachment)
    }
  }

  private async sendText(phone: string, text: string): Promise<void> {
    const delayMs = computeHumanTypingDelayMs(text)
    // Indicador nativo de "digitando..." é cosmético — nunca deve derrubar o envio real.
    await sendTypingPresence(this.config, phone, delayMs).catch(() => {})
    await sleep(delayMs)
    await sendWhatsAppMessage(this.config, phone, text)
  }

  /**
   * Tenta responder em nota de voz (TTS + envio de áudio). Sempre que
   * falhar por qualquer motivo (sem OPENAI_API_KEY, TTS fora do ar,
   * envio de mídia recusado pela Evolution API), cai para texto — nunca
   * trava nem fica em silêncio (item 5 do pedido). Devolve `true` só
   * quando o áudio foi de fato enviado.
   */
  private async trySendVoice(phone: string, text: string): Promise<boolean> {
    const apiKey = getOpenAIApiKey()
    if (!apiKey) return false

    try {
      const { base64Audio } = await synthesizeSpeech({ apiKey, text })

      const delayMs = computeHumanTypingDelayMs(text)
      // Indicador nativo de "gravando áudio..." em vez de "digitando..." — também cosmético.
      await sendRecordingPresence(this.config, phone, delayMs).catch(() => {})
      await sleep(delayMs)
      await sendWhatsAppAudio(this.config, phone, base64Audio)

      await logOpenAITtsUsage({ characterCount: text.length, unitId: this.unit.id, orgId: this.unit.org_id })
      await logSystemEvent(this.supabase, {
        level: 'info',
        source: 'openai',
        eventType: 'audio_synthesized',
        message: `Resposta em áudio sintetizada e enviada na unidade "${this.unit.name}" (${text.length} caracteres).`,
        orgId: this.unit.org_id,
        unitId: this.unit.id,
        metadata: { character_count: text.length },
      })
      return true
    } catch (error) {
      await logSystemEvent(this.supabase, {
        level: 'warning',
        source: 'openai',
        eventType: 'audio_synthesis_failed',
        message: `Falha ao sintetizar/enviar resposta em áudio na unidade "${this.unit.name}": ${error instanceof Error ? error.message : 'erro desconhecido'}. Respondendo em texto.`,
        orgId: this.unit.org_id,
        unitId: this.unit.id,
      })
      return false
    }
  }

  /**
   * Envia o PDF escolhido pelo modelo (biblioteca de anexos — migration
   * 036) como mensagem de mídia separada, depois da resposta em texto/voz.
   * Best-effort igual ao trySendVoice: uma falha aqui (contrato da
   * Evolution API diferente do assumido, arquivo inválido) só vira log —
   * nunca derruba a resposta de texto que já foi enviada com sucesso.
   */
  private async trySendDocument(phone: string, attachment: AttachmentToSend): Promise<void> {
    try {
      await sendWhatsAppDocument(
        this.config,
        phone,
        attachment.url,
        attachment.fileName || `${attachment.title}.pdf`,
        attachment.title,
      )
    } catch (error) {
      await logSystemEvent(this.supabase, {
        level: 'warning',
        source: 'evolution',
        eventType: 'attachment_send_failed',
        message: `Falha ao enviar anexo "${attachment.title}" via WhatsApp na unidade "${this.unit.name}": ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        orgId: this.unit.org_id,
        unitId: this.unit.id,
      })
    }
  }
}

class TwilioSmsChannel implements MessagingChannel {
  readonly type: ChannelType = 'sms'

  constructor(private readonly config: TwilioUnitConfig) {}

  async sendMessage(phone: string, text: string): Promise<void> {
    // Twilio não tem indicador de "digitando" — só o delay artificial (item b).
    await sleep(computeHumanTypingDelayMs(text))
    await sendSmsMessage(this.config, phone, text)
  }
}

/**
 * Endereço de reply-to que o agente consegue LER de volta (webhook em
 * app/api/webhooks/email). Usa plus-addressing com o id da unidade
 * (reply+{unit.id}@EMAIL_INBOUND_DOMAIN) num domínio da própria
 * plataforma com MX configurado pro Resend (Dashboard → Receiving) —
 * exige configuração de DNS, mas só da Alizo, nunca do domínio do
 * cliente. Sem EMAIL_INBOUND_DOMAIN configurada, mantém o comportamento
 * antigo (resposta cai direto na caixa real da empresa, sem o agente ver).
 */
export function getEmailReplyTo(unit: Unit): string | null {
  const inboundDomain = process.env.EMAIL_INBOUND_DOMAIN
  if (inboundDomain) return `reply+${unit.id}@${inboundDomain}`
  return unit.email_reply_to
}

/**
 * Canal de e-mail (item 1): mesmo motor de conversa, mesma persona —
 * só embrulha a resposta no template com a marca da unidade (logo,
 * layout profissional) e usa reply-to pra respostas caírem onde o
 * agente consegue processá-las (ver getEmailReplyTo). Ver lib/email.ts
 * (sendLeadEmail) para o "from" técnico: sempre o domínio da
 * plataforma, porque o domínio do cliente não está verificado no Resend.
 */
class ResendEmailChannel implements MessagingChannel {
  readonly type: ChannelType = 'email'

  constructor(private readonly unit: Unit) {}

  async sendMessage(email: string, text: string, context?: SendContext): Promise<void> {
    // E-mail não tem indicador de "digitando" — só o delay artificial (item b),
    // que também evita uma resposta automatizada com timestamp instantâneo demais.
    await sleep(computeHumanTypingDelayMs(text))
    const result = await sendLeadEmail({
      to: email,
      unitName: this.unit.name,
      personaName: context?.personaName || this.unit.name,
      logoUrl: this.unit.logo_url,
      subject: context?.subject || this.unit.name,
      bodyText: text,
      replyTo: getEmailReplyTo(this.unit),
      attachment: context?.attachment ?? null,
    })
    if (!result.ok) throw new Error(result.error || 'Falha ao enviar e-mail.')
  }
}

/**
 * Canal configurado para a unidade. `messaging_channel` é escolhido pelo
 * cliente (self-service, ver /dashboard/messaging/connect e a config da
 * unidade); null usa o padrão histórico (whatsapp) para não quebrar
 * unidades já em produção antes deste campo existir.
 */
export function getUnitChannelType(unit: Unit): MessagingChannelType {
  return unit.messaging_channel === 'sms' ? 'sms' : 'whatsapp'
}

/**
 * Instancia o provider de telefone certo para a unidade, ou null se não
 * configurado. `supabase` é opcional — só é usado pelo canal WhatsApp
 * para registrar em system_events o resultado de uma resposta em áudio
 * (ver SendContext.voiceReply); chamadas que nunca pedem voiceReply
 * podem omiti-lo.
 */
export function getMessagingChannel(unit: Unit, supabase: SupabaseClient | null = null): MessagingChannel | null {
  if (getUnitChannelType(unit) === 'sms') {
    const config = getTwilioConfig(unit)
    return config ? new TwilioSmsChannel(config) : null
  }

  const config = getEvolutionConfig(unit)
  return config ? new EvolutionWhatsAppChannel(config, unit, supabase) : null
}

/** Canal de e-mail da unidade, ou null se Resend não está configurado na plataforma. */
export function getEmailChannel(unit: Unit): MessagingChannel | null {
  if (!getResendApiKey() || !process.env.EMAIL_FROM_DOMAIN) return null
  return new ResendEmailChannel(unit)
}

export function channelLabel(type: ChannelType): string {
  if (type === 'sms') return 'SMS'
  if (type === 'email') return 'E-mail'
  return 'WhatsApp'
}

export type ChannelSendAttempt = { channel: ChannelType; ok: boolean; error?: string }

/**
 * Tenta enviar a mesma mensagem por todos os canais disponíveis para o
 * lead (item 2 do pedido): WhatsApp/SMS se o lead tem telefone e a
 * unidade tem o canal configurado, e-mail se o lead tem e-mail e a
 * plataforma tem Resend configurado. Um lead com os dois cadastrados
 * recebe pelos dois — o histórico fica consolidado porque quem chama
 * isto grava todas as tentativas na mesma linha de `lead_id` (ver
 * sendAcrossChannels em lib/conversation-engine.ts), nunca cria leads
 * ou conversas separadas por canal.
 */
export async function sendToLeadChannels(params: {
  unit: Unit
  lead: Pick<Lead, 'phone' | 'email'>
  text: string
  context?: SendContext
}): Promise<ChannelSendAttempt[]> {
  const attempts: ChannelSendAttempt[] = []

  if (params.lead.phone) {
    const channel = getMessagingChannel(params.unit)
    if (channel) {
      try {
        await channel.sendMessage(params.lead.phone, params.text, params.context)
        attempts.push({ channel: channel.type, ok: true })
      } catch (error) {
        attempts.push({
          channel: channel.type,
          ok: false,
          error: error instanceof Error ? error.message : 'Erro desconhecido.',
        })
      }
    }
  }

  if (params.lead.email) {
    const emailChannel = getEmailChannel(params.unit)
    if (emailChannel) {
      try {
        await emailChannel.sendMessage(params.lead.email, params.text, params.context)
        attempts.push({ channel: 'email', ok: true })
      } catch (error) {
        attempts.push({
          channel: 'email',
          ok: false,
          error: error instanceof Error ? error.message : 'Erro desconhecido.',
        })
      }
    }
  }

  return attempts
}
