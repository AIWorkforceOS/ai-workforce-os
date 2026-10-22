import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getSchedulingSettings } from '@/lib/scheduling'
import { handleAppointmentReminder } from '@/lib/scheduling/appointment-notifications'
import { logSystemEvent } from '@/lib/system-events'
import type { Appointment, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * Lembrete automático de agendamento (Agenda Inteligente, Fase 2, sub-etapa 6/7).
 *
 * Executado diariamente pelo Vercel Cron (ver vercel.json) — os 3 crons já
 * existentes (follow-up/traffic/recruiter) rodam 1x/dia, confirmando que o
 * plano Vercel atual não tem cron horário disponível. Por isso este cron
 * não tenta acertar "exatamente reminder_hours_before antes" — em vez
 * disso busca todo agendamento ativo (scheduled/confirmed), no futuro,
 * ainda sem lembrete, dentro de uma janela larga de busca
 * (REMINDER_LOOKAHEAD_HOURS, padrão 72h) e decide em código, por
 * agendamento, se o horário de lembrete já chegou (comparando
 * scheduling_settings.reminder_hours_before da unidade com agora). Rodando
 * 1x/dia isso garante um único lembrete por agendamento, disparado entre
 * reminder_hours_before e reminder_hours_before + ~24h antes do horário
 * marcado (nunca depois dele) — a folga de até 24h é o preço de não termos
 * cron horário; ver decisão documentada no relatório da sub-etapa.
 *
 * Idempotência: appointments.reminder_sent_at (migration 026/027), igual
 * ao padrão dos outros 3 timestamps de notificação automática.
 *
 * Env vars:
 *   CRON_SECRET              — obrigatório (Vercel envia como Bearer token)
 *   REMINDER_LOOKAHEAD_HOURS — janela de busca no banco, em horas (padrão 72)
 *   REMINDER_MAX_PER_RUN     — teto de agendamentos processados por execução (padrão 200)
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') ?? ''

  if (!cronSecret) {
    console.error('[cron/appointment-reminders] CRON_SECRET não configurado — cron desabilitado.')
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    console.error('[cron/appointment-reminders] SUPABASE_SERVICE_ROLE_KEY não configurada.')
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const lookaheadHours = intFromEnv('REMINDER_LOOKAHEAD_HOURS', 72)
  const maxPerRun = intFromEnv('REMINDER_MAX_PER_RUN', 200)

  const now = new Date()
  const lookaheadUntil = new Date(now.getTime() + lookaheadHours * 60 * 60 * 1000)

  const { data: rows, error: fetchError } = await supabase
    .from('appointments')
    .select('id, starts_at, units(*)')
    .in('status', ['scheduled', 'confirmed'])
    .is('reminder_sent_at', null)
    .gt('starts_at', now.toISOString())
    .lte('starts_at', lookaheadUntil.toISOString())
    .order('starts_at', { ascending: true })
    .limit(maxPerRun)

  if (fetchError) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'cron',
      eventType: 'appointment_reminder_query_failed',
      message: `Cron de lembrete abortado: falha ao buscar agendamentos: ${fetchError.message}`,
    })
    return NextResponse.json({ error: 'Falha ao buscar agendamentos.' }, { status: 500 })
  }

  type AppointmentRow = Pick<Appointment, 'id' | 'starts_at'> & { units: Unit | null }
  const candidates = (rows ?? []) as unknown as AppointmentRow[]

  let totalSent = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (const row of candidates) {
    const unit = row.units
    if (!unit || !unit.is_active) {
      totalSkipped += 1
      continue
    }

    const settings = getSchedulingSettings(unit)
    if (!settings.reminders_enabled) {
      totalSkipped += 1
      continue
    }

    const sendAt = new Date(row.starts_at).getTime() - settings.reminder_hours_before * 60 * 60 * 1000
    if (now.getTime() < sendAt) {
      totalSkipped += 1
      continue
    }

    try {
      await handleAppointmentReminder(supabase, { appointmentId: row.id, unit })
      totalSent += 1
    } catch (error) {
      totalErrors += 1
      await logSystemEvent(supabase, {
        level: 'error',
        source: 'cron',
        eventType: 'appointment_reminder_failed',
        message: `Falha no lembrete automático do agendamento ${row.id}: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        orgId: unit.org_id,
        unitId: unit.id,
      })
    }
  }

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'cron',
    eventType: 'appointment_reminder_run',
    message: `Cron de lembrete de agendamento executado: ${totalSent} enviados, ${totalSkipped} pulados, ${totalErrors} erros.`,
    metadata: { lookaheadHours, maxPerRun, candidates: candidates.length },
  })

  return NextResponse.json({ ok: true, sent: totalSent, skipped: totalSkipped, errors: totalErrors })
}
