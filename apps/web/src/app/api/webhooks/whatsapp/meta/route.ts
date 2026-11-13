import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { downloadMetaWhatsappMedia, getMetaWhatsappConfig } from '@/lib/meta-whatsapp'
import { getMessagingChannel } from '@/lib/channels/messaging-channel'
import { normalizePhone, routeInboundMessage } from '@/lib/inbound-router'
import { generateStructuredReplyFromImage, getOpenAIApiKey, transcribeAudio } from '@/lib/openai'
import { logOpenAIAudioUsage } from '@/lib/api-usage'
import { logSystemEvent } from '@/lib/system-events'
import { fetchOrgBillingStatus, isOrgBillingBlocked } from '@/lib/payments/billing-gate'
import { unitDefaultLocale } from '@/lib/i18n/config'
import type { Unit } from '@/lib/types'
import type { SupabaseClient } from '@supabase/supabase-js'

export const maxDuration = 60

type MetaMessage = {
  id?: string
  from?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  audio?: { id?: string; mime_type?: string }
  image?: { id?: string; mime_type?: string; caption?: string }
}

type MetaChange = {
  value?: {
    metadata?: { phone_number_id?: string }
    messages?: MetaMessage[]
  }
}

type MetaWebhook = { entry?: Array<{ changes?: MetaChange[] }> }

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.META_WHATSAPP_APP_SECRET?.trim()
  if (!secret || !signature?.startsWith('sha256=')) return false
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const left = Buffer.from(expected)
  const right = Buffer.from(signature)
  return left.length === right.length && timingSafeEqual(left, right)
}

function webhookMessages(body: MetaWebhook): Array<{ phoneNumberId: string; message: MetaMessage }> {
  const result: Array<{ phoneNumberId: string; message: MetaMessage }> = []
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const phoneNumberId = change.value?.metadata?.phone_number_id
      if (!phoneNumberId) continue
      for (const message of change.value?.messages ?? []) result.push({ phoneNumberId, message })
    }
  }
  return result
}

async function resolveText(unit: Unit, message: MetaMessage): Promise<{ text: string; wasAudio: boolean } | null> {
  if (message.type === 'text' && message.text?.body?.trim()) {
    return { text: message.text.body.trim(), wasAudio: false }
  }

  const config = getMetaWhatsappConfig(unit)
  const apiKey = getOpenAIApiKey()
  if (!config || !apiKey) return null

  if (message.type === 'audio' && message.audio?.id) {
    const media = await downloadMetaWhatsappMedia(config, message.audio.id)
    const transcription = await transcribeAudio({
      apiKey,
      base64Audio: Buffer.from(media.bytes).toString('base64'),
      mimeType: message.audio.mime_type || media.mimeType,
    })
    await logOpenAIAudioUsage({
      durationSeconds: transcription.durationSeconds,
      unitId: unit.id,
      orgId: unit.org_id,
    })
    return transcription.text ? { text: transcription.text, wasAudio: true } : null
  }

  if (message.type === 'image' && message.image?.id) {
    const media = await downloadMetaWhatsappMedia(config, message.image.id)
    if (media.bytes.byteLength === 0 || media.bytes.byteLength > MAX_IMAGE_BYTES) return null
    const analysis = await generateStructuredReplyFromImage<{
      description?: string
      visible_text?: string
      uncertainty?: string
    }>({
      apiKey,
      systemPrompt: 'Analise a imagem recebida no WhatsApp para continuar um atendimento. Descreva apenas o que estiver visível, transcreva textos legíveis e sinalize incertezas. Responda em JSON.',
      imageUrl: `data:${message.image.mime_type || media.mimeType};base64,${Buffer.from(media.bytes).toString('base64')}`,
      userText: message.image.caption
        ? `Legenda enviada pelo cliente: ${message.image.caption}`
        : 'Analise a imagem sem inventar informações.',
      maxTokens: 500,
    })
    const parts = [
      message.image.caption?.trim() ? `Legenda do cliente: ${message.image.caption.trim()}` : null,
      analysis.description?.trim() ? `Conteúdo observado na imagem: ${analysis.description.trim()}` : null,
      analysis.visible_text?.trim() ? `Texto visível: ${analysis.visible_text.trim()}` : null,
      analysis.uncertainty?.trim() ? `Incerteza: ${analysis.uncertainty.trim()}` : null,
    ].filter(Boolean)
    return parts.length ? { text: parts.join('\n'), wasAudio: false } : null
  }

  return null
}

async function processMessage(
  supabase: SupabaseClient,
  phoneNumberId: string,
  message: MetaMessage,
): Promise<void> {
  const { data } = await supabase
    .from('units')
    .select('*')
    .eq('meta_whatsapp_phone_number_id', phoneNumberId)
    .eq('whatsapp_connection_mode', 'official')
    .maybeSingle()
  const unit = data as Unit | null
  if (!unit) {
    await logSystemEvent(supabase, {
      level: 'error', source: 'meta_whatsapp', eventType: 'meta_whatsapp_unit_not_found',
      message: `Webhook oficial recebido para phone_number_id=${phoneNumberId}, sem unidade oficial correspondente.`,
      orgId: null, unitId: null,
    })
    return
  }

  try {
    const resolved = await resolveText(unit, message)
    if (!resolved) {
      if (message.type === 'audio' || message.type === 'image') {
        const incomingPhone = normalizePhone(message.from)
        const channel = getMessagingChannel(unit)
        if (channel && incomingPhone) {
          const locale = unitDefaultLocale(unit)
          const fallback = message.type === 'audio'
            ? (locale === 'en' ? "I couldn't hear your audio. Could you send it as text?" : 'Não consegui ouvir seu áudio. Pode enviar por texto?')
            : (locale === 'en' ? "I couldn't analyze the image. Could you describe it in text?" : 'Não consegui analisar a imagem. Pode descrevê-la por texto?')
          await channel.sendMessage(incomingPhone, fallback)
        }
      }
      return
    }

    const billingStatus = await fetchOrgBillingStatus(supabase, unit.org_id)
    if (isOrgBillingBlocked(billingStatus)) return

    await routeInboundMessage({
      supabase,
      unit,
      channel: 'whatsapp',
      incomingPhone: normalizePhone(message.from),
      incomingEmail: null,
      text: resolved.text,
      externalMessageId: message.id ?? null,
      sentAt: message.timestamp
        ? new Date(Number(message.timestamp) * 1000).toISOString()
        : new Date().toISOString(),
      wasAudioMessage: resolved.wasAudio,
    })
  } catch (error) {
    await logSystemEvent(supabase, {
      level: 'error', source: 'meta_whatsapp', eventType: 'meta_whatsapp_processing_failed',
      message: `Falha ao processar webhook oficial na unidade "${unit.name}": ${error instanceof Error ? error.message : String(error)}`,
      orgId: unit.org_id, unitId: unit.id,
    })
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  if (mode === 'subscribe' && token && token === process.env.META_WHATSAPP_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Verificação recusada.' }, { status: 403 })
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  if (!verifySignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 401 })
  }
  const body = JSON.parse(rawBody) as MetaWebhook
  const supabase = createServiceClient()
  if (!supabase) return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 503 })

  for (const item of webhookMessages(body)) {
    await processMessage(supabase, item.phoneNumberId, item.message)
  }
  return NextResponse.json({ ok: true })
}
