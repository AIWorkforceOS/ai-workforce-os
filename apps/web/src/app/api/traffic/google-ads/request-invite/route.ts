import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logSystemEvent } from '@/lib/system-events'

/**
 * Cliente preso no fluxo do Google Ads porque nunca recebeu o convite de
 * vínculo com a MCC da Alizo — sem isso, "Testar e conectar" nunca vai
 * funcionar. Este endpoint só registra o pedido (system_events) pro time
 * Alizo ver e enviar o convite manualmente; não há automação de convite
 * MCC nesta rodada.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: { unit_id?: string; customer_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  if (!body.unit_id) {
    return NextResponse.json({ error: 'Campo obrigatório: unit_id.' }, { status: 400 })
  }

  const { data: unit } = await supabase.from('units').select('id, org_id, name').eq('id', body.unit_id).single()
  if (!unit?.org_id) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }

  const customerId = body.customer_id?.trim() || '(não informado)'

  await logSystemEvent(supabase, {
    level: 'warning',
    source: 'google_ads',
    eventType: 'google_ads_invite_requested',
    message: `Cliente da unidade "${unit.name}" pediu o convite de vínculo MCC da Alizo no Google Ads (Customer ID: ${customerId}).`,
    orgId: unit.org_id,
    unitId: unit.id,
    metadata: { customer_id: customerId },
  })

  return NextResponse.json({ ok: true })
}
