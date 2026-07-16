import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { createServiceClient } from '@/lib/supabase/service'
import { normalizePhone, phonesMatch, routeInboundMessage } from '@/lib/inbound-router'
import type { Unit } from '@/lib/types'

export const maxDuration = 60

/**
 * Webhook de SMS recebido (Twilio). Espelha app/api/webhooks/whatsapp —
 * mesmo motor de conversa (lib/inbound-router.ts → SDR/Sales
 * Rep/Recruiter), só muda o transporte: Twilio manda o corpo como
 * form-urlencoded (não JSON) e a unidade é resolvida pelo número Twilio
 * de destino (units.twilio_phone_number) em vez do nome da instância
 * Evolution.
 */
export async function POST(request: Request) {
  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const rawBody = await request.text()
  const formParams = new URLSearchParams(rawBody)
  const from = formParams.get('From')
  const to = formParams.get('To')
  const body = formParams.get('Body')
  const messageSid = formParams.get('MessageSid')

  if (!from || !to || !body) {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const toPhone = normalizePhone(to)

  const { data: units } = await supabase
    .from('units')
    .select('*')
    .not('twilio_phone_number', 'is', null)

  const unitRow = ((units as Unit[] | null) ?? []).find((row) =>
    phonesMatch(normalizePhone(row.twilio_phone_number), toPhone),
  )

  if (!unitRow) {
    console.error(
      `[webhook_sms] mensagem recebida para o número "${to}" mas nenhuma unidade corresponde a ele — verifique units.twilio_phone_number.`,
    )
    return NextResponse.json({ error: 'Unidade não encontrada para este número.' }, { status: 404 })
  }

  // Confirma que a requisição realmente veio da Twilio antes de processar
  // — sem isso, qualquer um poderia forjar mensagens de clientes.
  const authToken = unitRow.twilio_auth_token || process.env.TWILIO_AUTH_TOKEN
  const signature = request.headers.get('x-twilio-signature')
  if (authToken && signature) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '')
    const proto = request.headers.get('x-forwarded-proto') ?? 'https'
    const host = request.headers.get('host') ?? ''
    const url = baseUrl ? `${baseUrl}/api/webhooks/sms` : `${proto}://${host}/api/webhooks/sms`

    const paramsObject = Object.fromEntries(formParams.entries())
    const valid = twilio.validateRequest(authToken, signature, url, paramsObject)
    if (!valid) {
      console.error('[webhook_sms] assinatura Twilio inválida — requisição rejeitada.')
      return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 403 })
    }
  } else {
    console.error(
      `[webhook_sms] sem auth token ou sem header de assinatura para a unidade "${unitRow.name}" — requisição processada sem validar autenticidade (configure twilio_auth_token).`,
    )
  }

  const incomingPhone = normalizePhone(from)
  const sentAt = new Date().toISOString()

  const result = await routeInboundMessage({
    supabase,
    unit: unitRow,
    channel: 'sms',
    incomingPhone,
    incomingEmail: null,
    text: body,
    externalMessageId: messageSid,
    sentAt,
  })

  return NextResponse.json(result)
}
