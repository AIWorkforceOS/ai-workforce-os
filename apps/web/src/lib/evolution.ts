import type { Unit } from '@/lib/types'
import { logEvolutionUsage } from '@/lib/api-usage'

export type EvolutionUnitConfig = {
  apiUrl: string
  apiKey: string
  instanceName: string
}

/**
 * Returns Evolution API config for a unit.
 * Per-unit fields take precedence; falls back to global env vars.
 * Instance name auto-generated as `unit-{slug}` if not explicitly set.
 */
export function getEvolutionConfig(unit: Unit): EvolutionUnitConfig | null {
  const apiUrl = unit.evolution_api_url || process.env.EVOLUTION_API_URL
  const apiKey = unit.evolution_api_key || process.env.EVOLUTION_API_KEY
  const instanceName = unit.evolution_instance_name || `unit-${unit.slug}`

  if (!apiUrl || !apiKey) return null

  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    apiKey,
    instanceName,
  }
}

async function evolutionFetch(
  config: EvolutionUnitConfig,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: config.apiKey,
      ...init?.headers,
    },
    cache: 'no-store',
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message =
      (data && (data.message || data.error)) || `Evolution API retornou status ${response.status}`
    throw new Error(Array.isArray(message) ? message.join(', ') : message)
  }

  return data
}

export type WhatsAppStatus = 'open' | 'connecting' | 'close' | 'not_configured'

export async function getInstanceStatus(config: EvolutionUnitConfig): Promise<WhatsAppStatus> {
  const data = await evolutionFetch(config, `/instance/connectionState/${config.instanceName}`)
  const state = data?.instance?.state ?? data?.state
  if (state === 'open') return 'open'
  if (state === 'connecting') return 'connecting'
  return 'close'
}

export async function connectInstance(config: EvolutionUnitConfig) {
  try {
    return await evolutionFetch(config, `/instance/connect/${config.instanceName}`)
  } catch {
    await evolutionFetch(config, '/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName: config.instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      }),
    })
    return evolutionFetch(config, `/instance/connect/${config.instanceName}`)
  }
}

export async function disconnectInstance(config: EvolutionUnitConfig) {
  return evolutionFetch(config, `/instance/logout/${config.instanceName}`, {
    method: 'DELETE',
  })
}

export async function sendWhatsAppMessage(config: EvolutionUnitConfig, phone: string, text: string) {
  const result = await evolutionFetch(config, `/message/sendText/${config.instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      number: phone,
      text,
    }),
  })
  await logEvolutionUsage('message.sendText')
  return result
}

/**
 * Baixa e decodifica (Baileys) o conteúdo de uma mensagem de mídia recebida
 * (ex.: áudio/nota de voz), a partir do id da mensagem no payload do
 * webhook. A URL que vem no payload é criptografada — não dá pra baixar
 * direto, por isso a Evolution API expõe esse endpoint que faz a
 * descriptografia e devolve em base64.
 */
export async function getBase64FromMediaMessage(
  config: EvolutionUnitConfig,
  messageId: string,
): Promise<{ base64: string; mimetype: string | null } | null> {
  const data = await evolutionFetch(config, `/chat/getBase64FromMediaMessage/${config.instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      message: { key: { id: messageId } },
      convertToMp4: false,
    }),
  })
  await logEvolutionUsage('chat.getBase64FromMediaMessage')
  if (!data?.base64) return null
  return { base64: data.base64, mimetype: data.mimetype ?? null }
}

/**
 * Mostra o indicador nativo de "digitando..." no WhatsApp do cliente por
 * `delayMs`. Best-effort: quem chama não deve deixar uma falha aqui
 * bloquear o envio da mensagem em si (ver EvolutionWhatsAppChannel em
 * lib/channels/messaging-channel.ts).
 */
export async function sendTypingPresence(config: EvolutionUnitConfig, phone: string, delayMs: number) {
  const result = await evolutionFetch(config, `/chat/sendPresence/${config.instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      number: phone,
      presence: 'composing',
      delay: delayMs,
    }),
  })
  await logEvolutionUsage('chat.sendPresence')
  return result
}
