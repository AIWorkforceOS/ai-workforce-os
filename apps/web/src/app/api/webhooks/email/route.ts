import { NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { createServiceClient } from '@/lib/supabase/service'
import { routeInboundMessage } from '@/lib/inbound-router'
import { getResendApiKey } from '@/lib/email'
import { logSystemEvent } from '@/lib/system-events'
import type { Unit } from '@/lib/types'

export const maxDuration = 60

/**
 * Webhook de e-mail recebido (Resend Inbound). Espelha
 * app/api/webhooks/whatsapp e app/api/webhooks/sms — mesmo motor de
 * conversa (lib/inbound-router.ts → SDR/Sales Rep/Recruiter), só muda o
 * transporte: o Resend manda um evento "email.received" (metadados, sem
 * corpo) assinado no padrão Svix; o corpo completo é buscado à parte na
 * API de Receiving. A unidade é resolvida pelo endereço de destino
 * (reply+{unit.id}@EMAIL_INBOUND_DOMAIN — ver getEmailReplyTo em
 * lib/channels/messaging-channel.ts, que é quem define esse endereço
 * como reply-to nos e-mails enviados ao lead).
 */

function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/)
  return (match ? match[1]! : raw).trim().toLowerCase()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function findUnitIdFromRecipients(to: string[], inboundDomain: string): string | null {
  for (const raw of to) {
    const address = extractEmailAddress(raw)
    const match = address.match(/^reply\+(.+)@(.+)$/i)
    // Valida o formato antes de usar em `.eq('id', unitId)` — camada extra
    // de defesa (achado da auditoria P0.2): sem isso, qualquer string após
    // "reply+" e antes do "@" era aceita sem checagem de forma.
    if (match && match[2]!.toLowerCase() === inboundDomain.toLowerCase() && UUID_RE.test(match[1]!)) {
      return match[1]!
    }
  }
  return null
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Corta a resposta do lead no primeiro sinal de citação do e-mail
 * anterior (">", "On ... wrote:", "Em ... escreveu:", cabeçalho de
 * encaminhamento) — sem isso, toda resposta reenviaria pro agente o
 * histórico inteiro da conversa junto com o texto novo.
 */
function stripEmailQuote(text: string): string {
  const patterns = [
    /\n\s*>/,
    /\n\s*On .+ wrote:/i,
    /\n\s*Em .+ escreveu:/i,
    /\n-{2,}\s*(Original Message|Mensagem original)/i,
    /\n\s*De:\s*.+\n\s*Enviad[ao]\s*(em|:)/i,
    /\n\s*From:\s*.+\n\s*Sent:/i,
  ]
  let cut = text.length
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.index !== undefined && match.index < cut) cut = match.index
  }
  return text.slice(0, cut).trim()
}

export async function POST(request: Request) {
  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const rawBody = await request.text()

  // Confirma que a requisição realmente veio do Resend antes de processar
  // — sem isso, qualquer um poderia forjar "respostas" de leads e disparar
  // fechamento de negócio (handleSalesDealHandoff) com dados inventados.
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (secret) {
    const svixId = request.headers.get('svix-id')
    const svixTimestamp = request.headers.get('svix-timestamp')
    const svixSignature = request.headers.get('svix-signature')
    if (!svixId || !svixTimestamp || !svixSignature) {
      console.error('[webhook_email] headers de assinatura ausentes — requisição rejeitada.')
      return NextResponse.json({ error: 'Assinatura ausente.' }, { status: 403 })
    }
    try {
      new Webhook(secret).verify(rawBody, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      })
    } catch {
      console.error('[webhook_email] assinatura Resend inválida — requisição rejeitada.')
      return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 403 })
    }
  } else {
    // console.error sozinho ficava invisível pra qualquer um fora de quem
    // acompanha os logs da Vercel em tempo real — sem RESEND_WEBHOOK_SECRET
    // configurada, QUALQUER requisição pode se passar por resposta de lead
    // (inclusive disparando handleSalesDealHandoff com dados forjados) e
    // ninguém no time ficava sabendo que esse risco está ativo em produção.
    // logSystemEvent grava em system_events (visível no painel) além do
    // console.error que já existia.
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'resend',
      eventType: 'email_webhook_unsigned',
      message:
        'RESEND_WEBHOOK_SECRET não configurada — o webhook de e-mail está processando requisições sem validar autenticidade (qualquer um pode forjar resposta de lead). Configure a variável de ambiente.',
    })
  }

  const body = JSON.parse(rawBody) as { type?: string; created_at?: string; data?: Record<string, unknown> }

  // Bounce/reclamação de spam (achado da auditoria P0.2): antes, esses
  // eventos eram descartados em silêncio — só o fluxo de campanhas de
  // marketing tratava isso (lib/marketing-email), nunca a prospecção fria
  // do Sales. Não mexemos em envio/opt-out automaticamente aqui (é uma
  // decisão de produto que envolve marketing_opt_out vs. consentimento de
  // prospecção, fora do escopo desta correção) — só deixamos de ser
  // invisível: fica registrado em system_events, visível no painel.
  if (body.type === 'email.bounced' || body.type === 'email.complained') {
    const bounceData = (body.data ?? {}) as Record<string, unknown>
    const toList = (bounceData.to as string[] | undefined) ?? []
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'resend',
      eventType: body.type === 'email.bounced' ? 'email_bounced' : 'email_complained',
      message:
        body.type === 'email.bounced'
          ? `E-mail de prospecção não entregue (bounce) para ${toList.join(', ') || 'destinatário desconhecido'}.`
          : `Destinatário marcou como spam/reclamação: ${toList.join(', ') || 'destinatário desconhecido'}.`,
      metadata: { to: toList, emailId: bounceData.email_id ?? null },
    })
    return NextResponse.json({ ok: true, logged: body.type })
  }

  if (body.type !== 'email.received') {
    return NextResponse.json({ ok: true, skipped: 'ignored_event_type' })
  }

  const data = body.data ?? {}
  const emailId = data.email_id as string | undefined
  const toList = (data.to as string[] | undefined) ?? []
  const fromRaw = data.from as string | undefined

  if (!emailId || !fromRaw || toList.length === 0) {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const inboundDomain = process.env.EMAIL_INBOUND_DOMAIN
  if (!inboundDomain) {
    return NextResponse.json({ error: 'EMAIL_INBOUND_DOMAIN não configurada.' }, { status: 500 })
  }

  const unitId = findUnitIdFromRecipients(toList, inboundDomain)
  if (!unitId) {
    console.error(
      `[webhook_email] nenhum destinatário reconhecido em [${toList.join(', ')}] — verifique EMAIL_INBOUND_DOMAIN e o endereço reply+{unitId}.`,
    )
    return NextResponse.json({ ok: true, skipped: 'unit_not_resolved' })
  }

  const { data: unit } = await supabase.from('units').select('*').eq('id', unitId).maybeSingle()
  if (!unit) {
    console.error(`[webhook_email] unidade "${unitId}" não encontrada.`)
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }
  const unitRow = unit as Unit

  const apiKey = getResendApiKey()
  if (!apiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY não configurada.' }, { status: 500 })
  }

  const emailResponse = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!emailResponse.ok) {
    console.error(`[webhook_email] falha ao buscar corpo do e-mail ${emailId}: status ${emailResponse.status}`)
    return NextResponse.json({ error: 'Falha ao buscar conteúdo do e-mail.' }, { status: 502 })
  }

  const emailData = (await emailResponse.json().catch(() => null)) as { text?: string | null; html?: string | null } | null
  const rawText = emailData?.text || stripHtml(emailData?.html || '')
  const text = stripEmailQuote(rawText)

  if (!text) {
    return NextResponse.json({ ok: true, skipped: 'empty_body' })
  }

  const incomingEmail = extractEmailAddress(fromRaw)
  const sentAt = body.created_at ?? new Date().toISOString()

  const result = await routeInboundMessage({
    supabase,
    unit: unitRow,
    channel: 'email',
    incomingPhone: null,
    incomingEmail,
    text,
    externalMessageId: emailId,
    sentAt,
  })

  return NextResponse.json(result)
}
