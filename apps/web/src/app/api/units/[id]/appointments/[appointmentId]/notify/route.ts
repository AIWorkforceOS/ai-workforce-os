import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  handleAppointmentBooked,
  handleAppointmentCancelled,
  handleAppointmentNoShow,
  handleAppointmentRescheduled,
} from '@/lib/scheduling/appointment-notifications'
import type { Unit } from '@/lib/types'

const NOTIFY_EVENTS = ['booked', 'rescheduled', 'cancelled', 'no_show'] as const
type NotifyEvent = (typeof NOTIFY_EVENTS)[number]

function isNotifyEvent(value: unknown): value is NotifyEvent {
  return typeof value === 'string' && (NOTIFY_EVENTS as readonly string[]).includes(value)
}

/**
 * Dispara a comunicação automática de agendamento (sub-etapa 5/7).
 * Chamado pelo cliente (appointment-form-modal.tsx / calendar-view.tsx)
 * logo após a mutação em `appointments` já ter sido gravada — este
 * endpoint só cuida do aviso, nunca do agendamento em si. Por isso
 * sempre responde 200 mesmo se o envio falhar: a falha já foi
 * registrada em system_events pelo handler (fail-safe), e não há nada
 * para o cliente reverter.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; appointmentId: string }> },
) {
  const { id, appointmentId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const event = (body as { event?: unknown } | null)?.event
  if (!isNotifyEvent(event)) {
    return NextResponse.json({ error: 'Evento inválido.' }, { status: 400 })
  }

  const { data: unit } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unit) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }
  const unitRow = unit as Unit

  try {
    if (event === 'booked') {
      await handleAppointmentBooked(supabase, { appointmentId, unit: unitRow })
    } else if (event === 'rescheduled') {
      await handleAppointmentRescheduled(supabase, { appointmentId, unit: unitRow })
    } else if (event === 'cancelled') {
      await handleAppointmentCancelled(supabase, { appointmentId, unit: unitRow })
    } else {
      await handleAppointmentNoShow(supabase, { appointmentId, unit: unitRow })
    }
  } catch (error) {
    console.error(
      `[appointments_notify] evento "${event}" falhou para o agendamento ${appointmentId}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return NextResponse.json({ ok: true })
}
