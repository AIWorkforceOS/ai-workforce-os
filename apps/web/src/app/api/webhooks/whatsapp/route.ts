import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { normalizePhone, routeInboundMessage } from '@/lib/inbound-router'
import { getEvolutionConfig, getBase64FromMediaMessage } from '@/lib/evolution'
import { getMessagingChannel } from '@/lib/channels/messaging-channel'
import { getOpenAIApiKey, transcribeAudio } from '@/lib/openai'
import { logOpenAIAudioUsage } from '@/lib/api-usage'
import { logSystemEvent } from '@/lib/system-events'
import { unitDefaultLocale } from '@/lib/i18n/config'
import type { Unit } from '@/lib/types'
import type { SupabaseClient } from '@supabase/supabase-js'

export const maxDuration = 60

const AUDIO_FALLBACK_MESSAGE: Record<'pt' | 'en', string> = {
  pt: 'Não consegui ouvir seu áudio direito agora — consegue escrever a mensagem, por favor?',
  en: "I couldn't quite catch that audio — could you send it as text instead?",
}

type ExtractedMessage = { kind: 'text'; text: string } | { kind: 'audio'; messageId: string; mimeType: string }

function extractInboundMessage(
  message: Record<string, unknown> | undefined,
  messageId: string | null,
): ExtractedMessage | null {
  if (!message) return null
  if (typeof message.conversation === 'string') return { kind: 'text', text: message.conversation }
  const extended = message.extendedTextMessage as { text?: string } | undefined
  if (extended?.text) return { kind: 'text', text: extended.text }
  const image = message.imageMessage as { caption?: string } | undefined
  if (image?.caption) return { kind: 'text', text: image.caption }
  const audio = message.audioMessage as { mimetype?: string } | undefined
  if (audio && messageId) {
    return { kind: 'audio', messageId, mimeType: audio.mimetype ?? 'audio/ogg' }
  }
  return null
}

/**
 * Baixa o áudio recebido (nota de voz/arquivo) da Evolution API e transcreve
 * via Whisper. Sem isso o funcionário digital simplesmente travaria numa
 * mensagem de áudio, já que o motor de conversa é 100% texto. Retorna null
 * (após já ter avisado o cliente) quando a transcrição não é possível —
 * quem chama não deve seguir o pipeline nesse caso.
 */
async function transcribeInboundAudio(params: {
  supabase: SupabaseClient
  unit: Unit
  messageId: string
  mimeType: string
  incomingPhone: string
}): Promise<string | null> {
  const { supabase, unit, messageId, mimeType, incomingPhone } = params
  const locale = unitDefaultLocale(unit)
  const openaiKey = getOpenAIApiKey()
  const evolutionConfig = getEvolutionConfig(unit)
  const messagingChannel = getMessagingChannel(unit)

  const fail = async (eventType: string, message: string) => {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'openai',
      eventType,
      message,
      orgId: unit.org_id,
      unitId: unit.id,
    })
    if (messagingChannel) {
      try {
        await messagingChannel.sendMessage(incomingPhone, AUDIO_FALLBACK_MESSAGE[locale])
      } catch (error) {
        console.error(
          `[webhook_whatsapp] falha ao enviar fallback de áudio: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return null
  }

  if (!openaiKey || !evolutionConfig) {
    return fail(
      'audio_transcription_skipped',
      `Áudio recebido na unidade "${unit.name}" mas OpenAI e/ou Evolution API não estão configurados — transcrição não é possível.`,
    )
  }

  try {
    const media = await getBase64FromMediaMessage(evolutionConfig, messageId)
    if (!media) {
      return fail(
        'audio_transcription_failed',
        `Áudio recebido na unidade "${unit.name}" mas a Evolution API não devolveu o conteúdo (mensagem "${messageId}").`,
      )
    }

    const { text, durationSeconds } = await transcribeAudio({
      apiKey: openaiKey,
      base64Audio: media.base64,
      mimeType: media.mimetype ?? mimeType,
    })

    if (!text) {
      return fail(
        'audio_transcription_empty',
        `Whisper não retornou texto para o áudio recebido na unidade "${unit.name}" (mensagem "${messageId}").`,
      )
    }

    await logOpenAIAudioUsage({ durationSeconds, unitId: unit.id, orgId: unit.org_id })
    await logSystemEvent(supabase, {
      level: 'info',
      source: 'openai',
      eventType: 'audio_transcribed',
      message: `Áudio transcrito na unidade "${unit.name}" (${durationSeconds.toFixed(1)}s).`,
      orgId: unit.org_id,
      unitId: unit.id,
      metadata: { duration_seconds: durationSeconds },
    })

    return text
  } catch (error) {
    return fail(
      'audio_transcription_failed',
      `Falha ao transcrever áudio na unidade "${unit.name}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function POST(request: Request) {
  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const instanceName: string | undefined = body.instance
  const data = body.data ?? {}
  const key = data.key ?? {}

  // Ignora mensagens enviadas pela própria unidade (eco do envio outbound)
  if (!instanceName || key.fromMe) {
    return NextResponse.json({ ok: true })
  }

  const extracted = extractInboundMessage(data.message, key.id ?? null)
  if (!extracted) {
    return NextResponse.json({ ok: true })
  }

  const { data: unit } = await supabase
    .from('units')
    .select('*')
    .eq('evolution_instance_name', instanceName)
    .maybeSingle()

  if (!unit) {
    console.error(
      `[webhook_whatsapp] mensagem recebida para instância "${instanceName}" mas nenhuma unidade corresponde a ela — verifique units.evolution_instance_name.`,
    )
    return NextResponse.json({ error: 'Unidade não encontrada para esta instância.' }, { status: 404 })
  }

  const unitRow = unit as Unit
  const remoteJid: string = key.remoteJid ?? ''
  const incomingPhone = normalizePhone(remoteJid.split('@')[0])

  let text: string
  if (extracted.kind === 'audio') {
    const transcribed = await transcribeInboundAudio({
      supabase,
      unit: unitRow,
      messageId: extracted.messageId,
      mimeType: extracted.mimeType,
      incomingPhone,
    })
    if (!transcribed) {
      return NextResponse.json({ ok: true, audioTranscriptionFailed: true })
    }
    text = transcribed
  } else {
    text = extracted.text
  }

  const sentAt = data.messageTimestamp
    ? new Date(Number(data.messageTimestamp) * 1000).toISOString()
    : new Date().toISOString()

  const result = await routeInboundMessage({
    supabase,
    unit: unitRow,
    channel: 'whatsapp',
    incomingPhone,
    incomingEmail: null,
    text,
    externalMessageId: key.id ?? null,
    sentAt,
  })

  return NextResponse.json(result)
}
