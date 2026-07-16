import type { MessagingChannelType, Unit } from '@/lib/types'
import { getEvolutionConfig, sendWhatsAppMessage, type EvolutionUnitConfig } from '@/lib/evolution'
import { getTwilioConfig, sendSmsMessage, type TwilioUnitConfig } from '@/lib/twilio'

// Abstração de canal de mensagens (item 1): o funcionário de IA (SDR,
// Sales Rep, Recruiter) fala com o cliente por WhatsApp (Evolution API)
// ou SMS (Twilio, para países como os EUA onde WhatsApp não é o canal
// dominante) sem precisar saber qual dos dois está por trás — só chama
// sendMessage. Qual provider é usado depende de units.messaging_channel
// (ver getUnitChannelType).

export type ChannelType = MessagingChannelType

export interface MessagingChannel {
  readonly type: ChannelType
  sendMessage(phone: string, text: string): Promise<void>
}

class EvolutionWhatsAppChannel implements MessagingChannel {
  readonly type: ChannelType = 'whatsapp'

  constructor(private readonly config: EvolutionUnitConfig) {}

  async sendMessage(phone: string, text: string): Promise<void> {
    await sendWhatsAppMessage(this.config, phone, text)
  }
}

class TwilioSmsChannel implements MessagingChannel {
  readonly type: ChannelType = 'sms'

  constructor(private readonly config: TwilioUnitConfig) {}

  async sendMessage(phone: string, text: string): Promise<void> {
    await sendSmsMessage(this.config, phone, text)
  }
}

/**
 * Canal configurado para a unidade. `messaging_channel` é escolhido pelo
 * cliente (self-service, ver /dashboard/messaging/connect e a config da
 * unidade); null usa o padrão histórico (whatsapp) para não quebrar
 * unidades já em produção antes deste campo existir.
 */
export function getUnitChannelType(unit: Unit): ChannelType {
  return unit.messaging_channel === 'sms' ? 'sms' : 'whatsapp'
}

/** Instancia o provider certo para a unidade, ou null se não configurado. */
export function getMessagingChannel(unit: Unit): MessagingChannel | null {
  if (getUnitChannelType(unit) === 'sms') {
    const config = getTwilioConfig(unit)
    return config ? new TwilioSmsChannel(config) : null
  }

  const config = getEvolutionConfig(unit)
  return config ? new EvolutionWhatsAppChannel(config) : null
}

export function channelLabel(type: ChannelType): string {
  return type === 'sms' ? 'SMS' : 'WhatsApp'
}
