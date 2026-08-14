import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  normalizePhone,
  phonesMatch,
  routeInboundMessage,
  routeReceptionistChannelMessage,
  isRecentOutboundEcho,
  findCustomerContext,
  findCandidateByIdentifier,
  findLeadByIdentifier,
} from '@/lib/inbound-router'
import { getBase64FromMediaMessage, resolveWhatsappChannelByInstanceName, syncWhatsappPhoneIfConnected, type EvolutionUnitConfig } from '@/lib/evolution'
import { getMessagingChannel } from '@/lib/channels/messaging-channel'
import { getOpenAIApiKey, transcribeAudio } from '@/lib/openai'
import { logOpenAIAudioUsage } from '@/lib/api-usage'
import { logSystemEvent } from '@/lib/system-events'
import { recordHumanIntervention } from '@/lib/human-intervention'
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
  evolutionConfig: EvolutionUnitConfig
  messageId: string
  mimeType: string
  incomingPhone: string
}): Promise<string | null> {
  const { supabase, unit, evolutionConfig, messageId, mimeType, incomingPhone } = params
  const locale = unitDefaultLocale(unit)
  const openaiKey = getOpenAIApiKey()
  const messagingChannel = getMessagingChannel(unit, null, evolutionConfig)

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

  if (!openaiKey) {
    return fail(
      'audio_transcription_skipped',
      `Áudio recebido na unidade "${unit.name}" mas OpenAI não está configurada — transcrição não é possível.`,
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

function resolveSentAt(messageTimestamp: unknown): string {
  return messageTimestamp ? new Date(Number(messageTimestamp) * 1000).toISOString() : new Date().toISOString()
}

/**
 * Mensagem `key.fromMe=true` chegando por QUALQUER instância dedicada
 * (Recepcionista, SDR, Recrutador — migration 051): normalmente é eco do
 * próprio envio automático (fecha a mesma corrida descrita em engine.ts)
 * — mas pode ser alguém da equipe digitando manualmente no WhatsApp
 * conectado pra intervir na conversa (dar a solução que a IA não achou,
 * responder algo que ela não sabia). Antes, isso só era tratado pra
 * instância da Recepcionista — SDR/Recrutador descartavam a mensagem em
 * silêncio (bug real, corrigido de graça por esta generalização).
 *
 * Nunca dispara sendMessage (a pessoa já mandou pelo WhatsApp de verdade)
 * nem roda o pipeline de IA. Duas responsabilidades:
 * (1) grava a mensagem como linha outbound normal (customer_messages ou
 *     conversations), pra aparecer no histórico da próxima vez que o
 *     contato escrever (pedido do Vinicius, 2026-08-06) — só cobre
 *     customer/lead, já que candidato usa candidate_messages com job_id
 *     obrigatório (fora do escopo aqui, não é crítico pra travar a IA);
 * (2) registra o evento `human_operator_message` (lib/human-intervention)
 *     pra travar qualquer resposta automática nesta conversa por 40min
 *     (pedido novo do dono, 2026-08-14) — cobre customer, candidato e lead.
 *
 * Se o número não bate com nenhum customer/candidate/lead cadastrado,
 * ignora (nunca cria lead a partir de mensagem da própria equipe).
 */
async function captureOperatorMessage(params: {
  supabase: SupabaseClient
  unit: Unit
  remoteJid: string
  message: Record<string, unknown> | undefined
  messageId: string | null
  messageTimestamp: unknown
}): Promise<void> {
  const { supabase, unit, remoteJid, message, messageId, messageTimestamp } = params
  const extracted = extractInboundMessage(message, messageId)
  if (!extracted || extracted.kind !== 'text') return

  const text = extracted.text
  const isEcho = await isRecentOutboundEcho(supabase, unit.id, text)
  if (isEcho) return

  const incomingPhone = normalizePhone(remoteJid.split('@')[0])
  const sentAt = resolveSentAt(messageTimestamp)

  const customer = await findCustomerContext(supabase, unit, incomingPhone, null)
  if (customer) {
    await supabase.from('customer_messages').insert({
      customer_id: customer.id,
      unit_id: unit.id,
      channel: 'whatsapp',
      direction: 'outbound',
      content: text,
      status: 'sent',
      sent_at: sentAt,
    })
    await recordHumanIntervention(supabase, { unit, contactId: customer.id })
    return
  }

  const candidate = await findCandidateByIdentifier(supabase, unit, incomingPhone, null)
  if (candidate) {
    await recordHumanIntervention(supabase, { unit, contactId: candidate.id })
    return
  }

  const lead = await findLeadByIdentifier(supabase, unit, incomingPhone, null)
  if (!lead) return

  await supabase.from('conversations').insert({
    lead_id: lead.id,
    unit_id: unit.id,
    channel: 'whatsapp',
    direction: 'outbound',
    content: text,
    status: 'sent',
    sent_at: sentAt,
  })
  await recordHumanIntervention(supabase, { unit, contactId: lead.id })
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
  const remoteJid: string = key.remoteJid ?? ''

  // Ignora mensagens de grupo do WhatsApp (JID termina em @g.us, diferente
  // do contato individual @s.whatsapp.net) — os funcionários digitais só
  // devem responder em conversas privadas 1:1, nunca em grupo.
  if (!instanceName || remoteJid.endsWith('@g.us')) {
    return NextResponse.json({ ok: true })
  }

  // Mensagens `fromMe` (enviadas pela própria unidade) não são mais
  // descartadas incondicionalmente pra nenhum agente: uma mensagem `fromMe`
  // que não é eco do envio automático é alguém da equipe intervindo
  // manualmente na conversa (ver captureOperatorMessage) — vale pra
  // Recepcionista, SDR e Recrutador por igual.
  if (key.fromMe) {
    const resolution = await resolveWhatsappChannelByInstanceName(supabase, instanceName)
    if (!resolution) {
      return NextResponse.json({ ok: true })
    }
    try {
      await captureOperatorMessage({
        supabase,
        unit: resolution.unit,
        remoteJid,
        message: data.message,
        messageId: key.id ?? null,
        messageTimestamp: data.messageTimestamp,
      })
      return NextResponse.json({ ok: true })
    } catch (error) {
      await logSystemEvent(supabase, {
        level: 'error',
        source: 'evolution',
        eventType: 'whatsapp_webhook_processing_failed',
        message: `Falha ao processar mensagem enviada pela própria equipe na unidade "${resolution.unit.name}": ${error instanceof Error ? error.message : String(error)}`,
        orgId: resolution.unit.org_id,
        unitId: resolution.unit.id,
      })
      return NextResponse.json({ ok: true, error: 'internal_error' })
    }
  }

  const extracted = extractInboundMessage(data.message, key.id ?? null)
  if (!extracted) {
    return NextResponse.json({ ok: true })
  }

  const resolution = await resolveWhatsappChannelByInstanceName(supabase, instanceName)

  if (!resolution) {
    console.error(
      `[webhook_whatsapp] mensagem recebida para instância "${instanceName}" mas nenhuma unidade corresponde a ela — verifique unit_whatsapp_channels/units.evolution_instance_name.`,
    )
    return NextResponse.json({ error: 'Unidade não encontrada para esta instância.' }, { status: 404 })
  }

  const { unit: unitRow, agentType, channel: resolvedChannel } = resolution

  // Tudo a partir daqui (self-heal, transcrição de áudio, roteamento) pode
  // falhar por motivos externos (timeout da OpenAI, erro da Evolution API,
  // erro de banco). Isso NÃO pode propagar como 500 pro webhook da Evolution
  // API: um erro nosso faz a Evolution reentregar a mesma mensagem (retry
  // com backoff, até ~10 tentativas), e a reentrega reprocessa a mensagem —
  // possível origem do bloqueio por rajada de resposta duplicada.
  try {
    // Self-heal: uma mensagem real chegando por esta instância já prova que
    // ela está conectada — não depende de o cliente ter deixado a tela do QR
    // code aberta até o polling captar o status 'open' (ver syncWhatsappPhoneIfConnected).
    const syncedPhone = await syncWhatsappPhoneIfConnected(supabase, unitRow, resolvedChannel)

    const incomingPhone = normalizePhone(remoteJid.split('@')[0])

    // Guarda contra eco do próprio envio: Evolution API (Baileys, protocolo
    // multi-device não-oficial) às vezes reentrega uma mensagem que NÓS
    // enviamos como se fosse um novo inbound, com `key.fromMe` ausente/falso
    // — o guard de fromMe (linha ~145) sozinho não cobre esse caso. Se o
    // remetente é o próprio número conectado a este canal, é eco, não uma
    // mensagem nova. Usa `syncedPhone` (valor recém-persistido acima) quando
    // `resolvedChannel.whatsappPhone` ainda não tinha sido sincronizado nesta
    // mesma invocação — sem isso, o self-heal na linha acima persiste o
    // telefone no banco mas esta variável em memória continua vazia até a
    // PRÓXIMA mensagem, deixando o guard inoperante bem na primeira vez que
    // ele seria útil.
    const ownPhone = normalizePhone(syncedPhone ?? resolvedChannel.whatsappPhone)
    if (ownPhone && phonesMatch(ownPhone, incomingPhone)) {
      await logSystemEvent(supabase, {
        level: 'info',
        source: 'evolution',
        eventType: 'whatsapp_webhook_self_echo_skipped',
        message: `Mensagem inbound na unidade "${unitRow.name}" veio do próprio número conectado a este canal (eco do Baileys/Evolution API) — ignorada.`,
        orgId: unitRow.org_id,
        unitId: unitRow.id,
      })
      return NextResponse.json({ ok: true, selfEcho: true })
    }

    let text: string
    if (extracted.kind === 'audio') {
      const transcribed = await transcribeInboundAudio({
        supabase,
        unit: unitRow,
        evolutionConfig: resolvedChannel.config,
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

    const sentAt = resolveSentAt(data.messageTimestamp)

    // Instância dedicada à Recepcionista (migration 051): toda mensagem
    // nesse número é dela, sem passar pela triagem genérica de Rota 3 —
    // ver routeReceptionistChannelMessage. Qualquer outro agent_type (ou
    // número compartilhado, sem canal dedicado) mantém o comportamento
    // atual (cascata completa em routeInboundMessage).
    const routeParams = {
      supabase,
      unit: unitRow,
      channel: 'whatsapp' as const,
      incomingPhone,
      incomingEmail: null,
      text,
      externalMessageId: key.id ?? null,
      sentAt,
      wasAudioMessage: extracted.kind === 'audio',
    }
    const result =
      agentType === 'receptionist'
        ? await routeReceptionistChannelMessage(routeParams)
        : await routeInboundMessage(routeParams)

    return NextResponse.json(result)
  } catch (error) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'evolution',
      eventType: 'whatsapp_webhook_processing_failed',
      message: `Falha ao processar mensagem inbound na unidade "${unitRow.name}": ${error instanceof Error ? error.message : String(error)}`,
      orgId: unitRow.org_id,
      unitId: unitRow.id,
    })
    // Sempre 200: um 500 aqui faz a Evolution API reentregar o webhook e
    // reprocessar a mesma mensagem (ver comentário acima do try).
    return NextResponse.json({ ok: true, error: 'internal_error' })
  }
}
