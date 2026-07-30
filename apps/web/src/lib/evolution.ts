import type { Unit } from '@/lib/types'
import { logEvolutionUsage } from '@/lib/api-usage'
import { logSystemEvent } from '@/lib/system-events'
import type { SupabaseClient } from '@supabase/supabase-js'

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

/**
 * Persiste units.whatsapp_phone quando a instância está de fato conectada
 * ('open') mas o número ainda não foi salvo — única fonte de verdade sobre
 * "WhatsApp conectado" pro resto do sistema (computeSetupStatus etc.).
 *
 * Existiam DUAS rotas de status (autenticada em /api/units/[id]/whatsapp/status
 * e pública em /api/public/units/[id]/whatsapp/status) e só a pública fazia
 * esse save — a rota que o wizard de conexão realmente usa (autenticada)
 * nunca persistia o telefone, então a conexão "funcionava" na Evolution mas
 * o app continuava mostrando "WhatsApp não conectado" pra sempre. Chamada
 * também no webhook de mensagens (self-heal): qualquer evento real da
 * instância já é prova de que ela está conectada, então não depende de o
 * cliente ter deixado a aba do QR code aberta até o fim.
 *
 * `/instance/fetchInstances` tem dois formatos possíveis conforme a versão
 * da Evolution API (mesma ressalva já tratada em getInstanceStatus para
 * /instance/connectionState): v1 aninha tudo em `.instance.{instanceName,owner}`;
 * v2 devolve um shape plano (`.name`, `.ownerJid`). Faltava esse fallback aqui
 * — confirmado contra produção em 2026-07-30: as unidades "Smarter Estágios 01"
 * e "Smarter Matriz" nunca tiveram whatsapp_phone preenchido mesmo recebendo
 * mensagens reais pelo webhook (prova de que a instância está conectada), porque
 * o find só batia no shape v1 e o servidor de produção devolve o shape v2.
 */
export async function syncWhatsappPhoneIfConnected(
  supabase: SupabaseClient,
  unit: Pick<Unit, 'id' | 'whatsapp_phone' | 'org_id'>,
  config: EvolutionUnitConfig,
): Promise<string | null> {
  if (unit.whatsapp_phone) return unit.whatsapp_phone
  try {
    const res = await fetch(`${config.apiUrl}/instance/fetchInstances`, {
      headers: { apikey: config.apiKey },
      cache: 'no-store',
    })
    if (!res.ok) {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'evolution',
        eventType: 'whatsapp_phone_sync_failed',
        message: `fetchInstances retornou status ${res.status} para a instância "${config.instanceName}" — não foi possível confirmar o número conectado.`,
        orgId: unit.org_id,
        unitId: unit.id,
      })
      return null
    }

    const instances = await res.json()
    type InstanceEntry = { instance?: { instanceName?: string; owner?: string }; name?: string; ownerJid?: string }
    const instance = Array.isArray(instances)
      ? (instances as InstanceEntry[]).find(
          (i) => (i.instance?.instanceName ?? i.name) === config.instanceName,
        )
      : null

    if (!instance) {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'evolution',
        eventType: 'whatsapp_phone_sync_no_match',
        message: `fetchInstances não retornou nenhuma instância chamada "${config.instanceName}" — não foi possível confirmar o número conectado.`,
        orgId: unit.org_id,
        unitId: unit.id,
      })
      return null
    }

    const owner = instance.instance?.owner ?? instance.ownerJid
    const phone = owner?.split('@')[0] ?? null
    if (phone) {
      await supabase.from('units').update({ whatsapp_phone: phone }).eq('id', unit.id)
    }
    return phone
  } catch (error) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'evolution',
      eventType: 'whatsapp_phone_sync_failed',
      message: `Falha ao sincronizar whatsapp_phone da instância "${config.instanceName}": ${error instanceof Error ? error.message : String(error)}`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
    return null
  }
}

export async function connectInstance(config: EvolutionUnitConfig) {
  try {
    const result = await evolutionFetch(config, `/instance/connect/${config.instanceName}`)
    await ensureWebhookConfigured(config)
    return result
  } catch {
    await evolutionFetch(config, '/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName: config.instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      }),
    })
    await ensureWebhookConfigured(config)
    return evolutionFetch(config, `/instance/connect/${config.instanceName}`)
  }
}

/**
 * Registra na Evolution API a URL do nosso webhook de mensagens
 * (/api/webhooks/whatsapp) para esta instância — sem isso, a Evolution API
 * nunca sabe pra onde mandar as mensagens recebidas e o funcionário digital
 * nunca fica sabendo que alguém escreveu (causa raiz real, confirmada contra
 * produção em 2026-07-29: `leads`/`conversations`/`customer_messages` estavam
 * zerados no banco inteiro — nenhuma unidade jamais recebeu uma mensagem
 * inbound processada — porque `/instance/create` nunca configurava webhook
 * nenhum). Best-effort e idempotente: chamado tanto ao conectar quanto,
 * como self-heal, sempre que o status da instância é consultado e está
 * 'open' (ver rotas de whatsapp/status) — cobre instâncias que já existiam
 * antes deste fix sem exigir que o cliente reconecte o QR code. Contrato do
 * endpoint (`POST /webhook/set/{instance}` com `{ webhook: { url, enabled,
 * events } }`) segue a documentação pública da Evolution API v2 mas não foi
 * confirmado contra o servidor real de produção (mesma ressalva de
 * sendWhatsAppDocument).
 */
export async function ensureWebhookConfigured(config: EvolutionUnitConfig): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) return

  const webhookUrl = `${appUrl.replace(/\/+$/, '')}/api/webhooks/whatsapp`

  try {
    await evolutionFetch(config, `/webhook/set/${config.instanceName}`, {
      method: 'POST',
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          events: ['MESSAGES_UPSERT'],
        },
      }),
    })
  } catch (error) {
    console.error(
      `[evolution] falha ao configurar webhook da instância "${config.instanceName}": ${error instanceof Error ? error.message : String(error)}`,
    )
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
 * Envia uma nota de voz (ptt) — resposta em áudio, espelhando o cliente
 * que mandou áudio (ver EvolutionWhatsAppChannel em
 * lib/channels/messaging-channel.ts). `base64Audio` já vem em Ogg/Opus
 * de synthesizeSpeech (lib/openai.ts), o formato que este endpoint da
 * Evolution API espera para nota de voz.
 */
export async function sendWhatsAppAudio(config: EvolutionUnitConfig, phone: string, base64Audio: string) {
  const result = await evolutionFetch(config, `/message/sendWhatsAppAudio/${config.instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      number: phone,
      audio: base64Audio,
    }),
  })
  await logEvolutionUsage('message.sendWhatsAppAudio')
  return result
}

/**
 * Envia um documento (PDF da biblioteca de anexos — migration 036) via
 * mídia da Evolution API. Contrato assumido a partir da documentação
 * pública do endpoint /message/sendMedia (mediatype 'document', media
 * como URL pública, fileName, caption opcional) — NÃO foi confirmado
 * contra a instância real de produção; se a Evolution API em uso tiver
 * um contrato diferente, este envio falha e cai no tratamento best-effort
 * de EvolutionWhatsAppChannel (loga e segue, nunca derruba a resposta de texto).
 */
export async function sendWhatsAppDocument(
  config: EvolutionUnitConfig,
  phone: string,
  documentUrl: string,
  fileName: string,
  caption?: string,
) {
  const result = await evolutionFetch(config, `/message/sendMedia/${config.instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      number: phone,
      mediatype: 'document',
      media: documentUrl,
      fileName,
      ...(caption ? { caption } : {}),
    }),
  })
  await logEvolutionUsage('message.sendMedia')
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
async function sendPresence(config: EvolutionUnitConfig, phone: string, presence: 'composing' | 'recording', delayMs: number) {
  const result = await evolutionFetch(config, `/chat/sendPresence/${config.instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      number: phone,
      presence,
      delay: delayMs,
    }),
  })
  await logEvolutionUsage('chat.sendPresence')
  return result
}

export async function sendTypingPresence(config: EvolutionUnitConfig, phone: string, delayMs: number) {
  return sendPresence(config, phone, 'composing', delayMs)
}

/** Indicador nativo de "gravando áudio..." — usado antes de uma resposta em voz (ver sendTypingPresence). */
export async function sendRecordingPresence(config: EvolutionUnitConfig, phone: string, delayMs: number) {
  return sendPresence(config, phone, 'recording', delayMs)
}
