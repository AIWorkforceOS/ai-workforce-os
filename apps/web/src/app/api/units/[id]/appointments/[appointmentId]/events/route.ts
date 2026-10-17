import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isFieldEventType } from '@/lib/portal-funcionario/field-time'

/**
 * Marco de campo da ordem (iniciar viagem / check-in / fim) com posição do GPS.
 * Quem grava é a função record_appointment_event (migration 091): confere que a
 * ordem é do técnico logado, grava cada marco uma vez (reenvio da fila é
 * idempotente) e valida o horário. Roda com o client do usuário.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; appointmentId: string }> }) {
  const { id: unitId, appointmentId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { type?: unknown; at?: unknown; lat?: unknown; lng?: unknown; accuracy?: unknown } | null
  if (!body || !isFieldEventType(body.type)) return NextResponse.json({ error: 'Evento inválido.' }, { status: 400 })

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const at = typeof body.at === 'string' && !Number.isNaN(Date.parse(body.at)) ? body.at : null

  // A ordem precisa ser desta unidade (a RLS já esconde as dos outros).
  const { data: existing } = await supabase.from('appointments').select('id').eq('id', appointmentId).eq('unit_id', unitId).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 })

  const { data, error } = await supabase.rpc('record_appointment_event', {
    p_appointment_id: appointmentId,
    p_type: body.type,
    p_at: at,
    p_lat: num(body.lat),
    p_lng: num(body.lng),
    p_accuracy: num(body.accuracy),
  })
  if (error) {
    const notMine = /appointment_not_found|not_an_employee/.test(error.message)
    return NextResponse.json({ error: notMine ? 'Esta ordem não é sua.' : error.message }, { status: notMine ? 403 : 400 })
  }
  return NextResponse.json({ ok: true, events: data })
}
