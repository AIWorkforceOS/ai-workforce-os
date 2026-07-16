import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logSystemEvent } from '@/lib/system-events'
import { validateTwilioCredentials } from '@/lib/twilio'

/**
 * Conexão self-service do canal SMS (Twilio) por unidade — mesmo padrão
 * de /api/traffic/accounts/connect (Meta/Google Ads): SEMPRE testamos a
 * credencial com uma chamada real na Twilio antes de gravar, e ao
 * conectar com sucesso já deixamos a unidade configurada para usar SMS
 * (messaging_channel = 'sms'), já que é para isso que o cliente está
 * preenchendo este formulário.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: {
    unit_id?: string
    account_sid?: string
    auth_token?: string
    phone_number?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  const accountSid = body.account_sid?.trim()
  const authToken = body.auth_token?.trim()
  const phoneNumber = body.phone_number?.trim()

  if (!body.unit_id || !accountSid || !authToken || !phoneNumber) {
    return NextResponse.json(
      { error: 'Campos obrigatórios: unit_id, account_sid, auth_token, phone_number.' },
      { status: 400 },
    )
  }

  const { data: unit } = await supabase
    .from('units')
    .select('id, org_id')
    .eq('id', body.unit_id)
    .single()
  if (!unit?.org_id) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }

  const test = await validateTwilioCredentials({ accountSid, authToken, phoneNumber })

  if (!test.ok) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'twilio',
      eventType: 'sms_self_serve_connect_failed',
      message: `Conexão self-service da Twilio falhou (número ${phoneNumber}): ${test.error}`,
      orgId: unit.org_id,
      unitId: body.unit_id,
    })
    return NextResponse.json({ error: test.error }, { status: 422 })
  }

  const { error } = await supabase
    .from('units')
    .update({
      twilio_account_sid: accountSid,
      twilio_auth_token: authToken,
      twilio_phone_number: phoneNumber,
      messaging_channel: 'sms',
    })
    .eq('id', body.unit_id)

  if (error) {
    const isPermissionError = error.code === '42501'
    return NextResponse.json(
      { error: isPermissionError ? 'Só administradores da organização podem conectar o canal de SMS.' : error.message },
      { status: isPermissionError ? 403 : 500 },
    )
  }

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'twilio',
    eventType: 'sms_self_serve_connected',
    message: `Cliente conectou o canal SMS (Twilio, número ${phoneNumber}) via self-service.`,
    orgId: unit.org_id,
    unitId: body.unit_id,
  })

  return NextResponse.json({ label: test.label }, { status: 200 })
}
