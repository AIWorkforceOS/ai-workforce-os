import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveWhatsappChannel, sendWhatsAppMessage } from '@/lib/evolution'
import { zonedTimeToUtc, localDateString } from '@/lib/slot-engine'
import { unitDefaultLocale } from '@/lib/i18n/config'
import { logSystemEvent } from '@/lib/system-events'
import type { Appointment, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Resumo diário da agenda pro WhatsApp do gestor (pedido do Vinicius,
 * 2026-08-25): "ela sempre envia msg para ele no whats para
 * confirmações, informaçoes etc." Roda 1x/dia (mesma limitação de cron
 * horário dos demais crons do produto, ver appointment-reminders/route.ts
 * — o plano Vercel atual não tem cron por hora), listando os
 * agendamentos de HOJE (calculado no timezone da própria unidade, não
 * UTC) pra cada unidade com `manager_whatsapp_phone` configurado (ver
 * migration 074 e dashboard/settings).
 *
 * Envia pelo canal dedicado da Recepcionista — é ela quem "fala" com o
 * gestor no pedido original. Sem canal dedicado da Recepcionista
 * configurado, pula a unidade (loga, não quebra o cron inteiro).
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') ?? ''

  if (!cronSecret) {
    console.error('[cron/manager-agenda-digest] CRON_SECRET não configurado — cron desabilitado.')
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    console.error('[cron/manager-agenda-digest] SUPABASE_SERVICE_ROLE_KEY não configurada.')
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const { data: unitsData, error: unitsError } = await supabase
    .from('units')
    .select('*')
    .eq('is_active', true)
    .not('manager_whatsapp_phone', 'is', null)

  if (unitsError) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'cron',
      eventType: 'manager_agenda_digest_query_failed',
      message: `Cron do resumo diário abortado: falha ao buscar unidades: ${unitsError.message}`,
    })
    return NextResponse.json({ error: 'Falha ao buscar unidades.' }, { status: 500 })
  }

  const units = (unitsData ?? []) as Unit[]
  let totalSent = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (const unit of units) {
    try {
      const sent = await sendDailyDigestForUnit(supabase, unit)
      if (sent) totalSent += 1
      else totalSkipped += 1
    } catch (error) {
      totalErrors += 1
      await logSystemEvent(supabase, {
        level: 'error',
        source: 'cron',
        eventType: 'manager_agenda_digest_failed',
        message: `Falha no resumo diário da agenda da unidade "${unit.name}": ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        orgId: unit.org_id,
        unitId: unit.id,
      })
    }
  }

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'cron',
    eventType: 'manager_agenda_digest_run',
    message: `Cron do resumo diário da agenda executado: ${totalSent} enviados, ${totalSkipped} pulados, ${totalErrors} erros.`,
    metadata: { units: units.length },
  })

  return NextResponse.json({ ok: true, sent: totalSent, skipped: totalSkipped, errors: totalErrors })
}

/** Monta e envia o resumo do dia pra uma unidade — retorna true se enviou. */
async function sendDailyDigestForUnit(supabase: SupabaseClient, unit: Unit): Promise<boolean> {
  if (!unit.manager_whatsapp_phone) return false

  const channel = await resolveWhatsappChannel(supabase, unit, 'receptionist')
  if (!channel) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'cron',
      eventType: 'manager_agenda_digest_no_channel',
      message: `Unidade "${unit.name}" tem WhatsApp do gestor configurado, mas a Recepcionista não tem canal de WhatsApp dedicado — resumo não enviado.`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
    return false
  }

  const todayStr = localDateString(new Date(), unit.timezone)
  const startOfDay = zonedTimeToUtc(todayStr, '00:00', unit.timezone)
  const endOfDay = zonedTimeToUtc(todayStr, '23:59', unit.timezone)

  const { data: appointmentsData } = await supabase
    .from('appointments')
    .select('id, customer_id, service_id, starts_at, status')
    .eq('unit_id', unit.id)
    .in('status', ['scheduled', 'confirmed'])
    .gte('starts_at', startOfDay.toISOString())
    .lte('starts_at', endOfDay.toISOString())
    .order('starts_at', { ascending: true })

  const appointments = (appointmentsData ?? []) as Pick<Appointment, 'id' | 'customer_id' | 'service_id' | 'starts_at' | 'status'>[]

  const text = await buildDigestMessage(supabase, unit, appointments)
  await sendWhatsAppMessage(channel.config, unit.manager_whatsapp_phone, text)
  return true
}

async function buildDigestMessage(
  supabase: SupabaseClient,
  unit: Unit,
  appointments: Pick<Appointment, 'id' | 'customer_id' | 'service_id' | 'starts_at' | 'status'>[],
): Promise<string> {
  const locale = unitDefaultLocale(unit)
  const dateLabel = new Date().toLocaleDateString(locale === 'en' ? 'en-US' : 'pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    timeZone: unit.timezone,
  })

  if (appointments.length === 0) {
    return locale === 'en'
      ? `Good morning! No appointments scheduled for today (${dateLabel}) at ${unit.name}.`
      : `Bom dia! Nenhum agendamento pra hoje (${dateLabel}) na ${unit.name}.`
  }

  const customerIds = [...new Set(appointments.map((a) => a.customer_id))]
  const serviceIds = [...new Set(appointments.map((a) => a.service_id).filter((id): id is string => !!id))]

  const [{ data: customersData }, { data: servicesData }] = await Promise.all([
    supabase.from('customers').select('id, name').in('id', customerIds),
    serviceIds.length > 0
      ? supabase.from('services').select('id, name').in('id', serviceIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])

  const customerNameById = new Map(((customersData ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]))
  const serviceNameById = new Map(((servicesData ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]))

  const lines = appointments.map((a) => {
    const time = new Date(a.starts_at).toLocaleTimeString(locale === 'en' ? 'en-US' : 'pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: unit.timezone,
      hour12: locale === 'en',
    })
    const customerName = customerNameById.get(a.customer_id) ?? (locale === 'en' ? 'Unknown customer' : 'Cliente sem nome')
    const serviceName = a.service_id ? serviceNameById.get(a.service_id) : null
    return `• ${time} — ${customerName}${serviceName ? ` (${serviceName})` : ''}`
  })

  const header =
    locale === 'en'
      ? `Good morning! Today's agenda (${dateLabel}) at ${unit.name} — ${appointments.length} appointment(s):`
      : `Bom dia! Agenda de hoje (${dateLabel}) na ${unit.name} — ${appointments.length} agendamento(s):`

  return [header, ...lines].join('\n')
}
