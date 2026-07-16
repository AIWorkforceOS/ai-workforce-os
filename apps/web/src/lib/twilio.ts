import twilio from 'twilio'
import type { Unit } from '@/lib/types'
import { logTwilioUsage } from '@/lib/api-usage'

export type TwilioUnitConfig = {
  accountSid: string
  authToken: string
  phoneNumber: string
}

/**
 * Returns Twilio config for a unit (SMS nos EUA e outros países onde
 * WhatsApp/Evolution não é o canal dominante). Per-unit fields take
 * precedence; falls back to global env vars — mesmo padrão de
 * lib/evolution.ts. Cada empresa cliente nos EUA normalmente tem sua
 * própria conta Twilio (registro A2P 10DLC é por empresa), então na
 * prática quase sempre são os campos da unidade que resolvem isso.
 */
export function getTwilioConfig(unit: Unit): TwilioUnitConfig | null {
  const accountSid = unit.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID
  const authToken = unit.twilio_auth_token || process.env.TWILIO_AUTH_TOKEN
  const phoneNumber = unit.twilio_phone_number || process.env.TWILIO_PHONE_NUMBER

  if (!accountSid || !authToken || !phoneNumber) return null

  return { accountSid, authToken, phoneNumber }
}

function twilioClient(config: TwilioUnitConfig) {
  return twilio(config.accountSid, config.authToken)
}

function toE164(phone: string): string {
  return phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`
}

// SMS tem limite de 160 caracteres por segmento (70 se tiver emoji/unicode);
// mensagens maiores viram múltiplos segmentos e custam proporcionalmente
// mais. Truncamos respostas muito longas geradas pelo agente para evitar
// custo inesperado com uma resposta que "vazou" do limite de frases curtas
// do system prompt — não é o mecanismo principal de controle de tamanho,
// só uma rede de segurança.
const SMS_MAX_LENGTH = 480 // ~3 segmentos GSM-7

export function truncateForSms(text: string): string {
  if (text.length <= SMS_MAX_LENGTH) return text
  return `${text.slice(0, SMS_MAX_LENGTH - 1).trimEnd()}…`
}

export function smsSegmentCount(text: string): number {
  const hasUnicode = /[^\x00-\x7F]/.test(text)
  const singleSegmentLimit = hasUnicode ? 70 : 160
  const multiSegmentLimit = hasUnicode ? 67 : 153
  if (text.length === 0) return 0
  if (text.length <= singleSegmentLimit) return 1
  return Math.ceil(text.length / multiSegmentLimit)
}

export async function sendSmsMessage(config: TwilioUnitConfig, phone: string, text: string) {
  const client = twilioClient(config)
  const body = truncateForSms(text)

  const message = await client.messages.create({
    to: toE164(phone),
    from: config.phoneNumber,
    body,
  })

  await logTwilioUsage({ endpoint: 'messages.create', segments: smsSegmentCount(body) })
  return message
}

export type TwilioValidationResult = { ok: true; label: string } | { ok: false; error: string }

/**
 * Valida credenciais Twilio com uma chamada real (busca a conta + confirma
 * que o número informado pertence a ela) antes de salvar — mesmo padrão de
 * lib/traffic/connection-test.ts para Meta/Google Ads.
 */
export async function validateTwilioCredentials(config: TwilioUnitConfig): Promise<TwilioValidationResult> {
  try {
    const client = twilioClient(config)
    const account = await client.api.v2010.accounts(config.accountSid).fetch()

    if (account.status !== 'active') {
      return {
        ok: false,
        error: `Conta Twilio encontrada, mas o status dela é "${account.status}" (esperado: active).`,
      }
    }

    const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: config.phoneNumber, limit: 1 })
    if (numbers.length === 0) {
      return {
        ok: false,
        error: `O número ${config.phoneNumber} não foi encontrado nesta conta Twilio. Confirme que ele foi comprado/importado nesta mesma conta.`,
      }
    }

    return { ok: true, label: `${account.friendlyName} (${config.phoneNumber})` }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao validar as credenciais da Twilio.',
    }
  }
}
