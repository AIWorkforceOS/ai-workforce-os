import type { SupabaseClient } from '@supabase/supabase-js'
import { sendToLeadChannels } from '@/lib/channels/messaging-channel'
import { logSystemEvent } from '@/lib/system-events'
import { getSchedulingSettings } from '@/lib/scheduling'
import { unitDefaultLocale } from '@/lib/i18n/config'
import type { Locale } from '@/lib/i18n/config'
import type { Appointment, Customer, Unit } from '@/lib/types'

// Comunicação automática do Agenda Inteligente (Fase 2, sub-etapa 5/7):
// 4 gatilhos hardcoded no mesmo molde de handleSalesDealHandoff
// (lib/sales/deal-handoff.ts) — mensagem de texto determinística (sem
// LLM, funciona sem OPENAI_API_KEY), fail-safe (erro de envio nunca
// derruba agendar/reagendar/cancelar/marcar falta, só fica em
// system_events) e idempotente por coluna de timestamp em appointments
// (mesmo padrão de confirmation_sent_at, migration 026).
//
// Decisão sobre no-show (não coberta explicitamente no plano): só
// notificação interna (system_events), sem mensagem automática ao
// cliente. Avisar o cliente que ele "faltou" de forma automática e
// genérica é uma decisão de tom/política (ex.: cobrança de taxa de
// no-show) que varia por negócio e não foi ensinada em lugar nenhum
// desta configuração — mandar isso errado é pior do que não mandar.

function fmtMoment(iso: string, timezone: string, locale: Locale): string {
  const date = new Date(iso)
  const dateLocale = locale === 'en' ? 'en-US' : 'pt-BR'
  const datePart = date.toLocaleDateString(dateLocale, {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
  })
  const timePart = date.toLocaleTimeString(dateLocale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
    hour12: locale === 'en',
  })
  return locale === 'en' ? `${datePart} at ${timePart}` : `${datePart} às ${timePart}`
}

function serviceSuffix(serviceName: string | null): string {
  return serviceName ? ` (${serviceName})` : ''
}

function bookedMessage(customerName: string, unitName: string, when: string, serviceName: string | null, locale: Locale): string {
  return locale === 'en'
    ? `Hi ${customerName}! Your appointment at ${unitName} is confirmed for ${when}${serviceSuffix(serviceName)}. Reply here if you have any questions.`
    : `Olá, ${customerName}! Seu agendamento na ${unitName} foi confirmado para ${when}${serviceSuffix(serviceName)}. Qualquer dúvida, é só responder por aqui.`
}

function rescheduledMessage(customerName: string, unitName: string, when: string, serviceName: string | null, locale: Locale): string {
  return locale === 'en'
    ? `Hi ${customerName}! Your appointment at ${unitName} has been rescheduled to ${when}${serviceSuffix(serviceName)}.`
    : `Olá, ${customerName}! Seu agendamento na ${unitName} foi remarcado para ${when}${serviceSuffix(serviceName)}.`
}

function cancelledMessage(customerName: string, unitName: string, when: string, serviceName: string | null, locale: Locale): string {
  return locale === 'en'
    ? `Hi ${customerName}, your appointment at ${unitName} on ${when}${serviceSuffix(serviceName)} has been cancelled.`
    : `Olá, ${customerName}. Seu agendamento na ${unitName} de ${when}${serviceSuffix(serviceName)} foi cancelado.`
}

function reminderMessage(customerName: string, unitName: string, when: string, serviceName: string | null, locale: Locale): string {
  return locale === 'en'
    ? `Hi ${customerName}! Reminder: you have an appointment at ${unitName} on ${when}${serviceSuffix(serviceName)}.`
    : `Olá, ${customerName}! Lembrete: você tem um agendamento na ${unitName} em ${when}${serviceSuffix(serviceName)}.`
}

function onMyWayMessage(params: {
  customerName: string
  unitName: string
  time: string
  serviceName: string | null
  employeeName: string | null
  address: string | null
  locale: Locale
}): string {
  const { customerName, unitName, time, serviceName, employeeName, address, locale } = params
  if (locale === 'en') {
    const who = employeeName ? `${employeeName} from ${unitName}` : `The ${unitName} team`
    const addressPart = address ? ` Service address: ${address}.` : ''
    return `Hi ${customerName}! ${who} is on the way to your appointment today at ${time}${serviceSuffix(serviceName)}.${addressPart}`
  }
  const who = employeeName ? `${employeeName}, da ${unitName},` : `A equipe da ${unitName}`
  const addressPart = address ? ` Endereço do atendimento: ${address}.` : ''
  return `Olá, ${customerName}! ${who} está a caminho do seu atendimento de hoje às ${time}${serviceSuffix(serviceName)}.${addressPart}`
}

type AppointmentContext = {
  appointment: Appointment
  customer: Pick<Customer, 'id' | 'name' | 'phone' | 'email'>
  serviceName: string | null
}

async function loadAppointmentContext(
  supabase: SupabaseClient,
  appointmentId: string,
): Promise<AppointmentContext | null> {
  const { data: appointmentRow } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .maybeSingle()
  const appointment = appointmentRow as Appointment | null
  if (!appointment) return null

  const { data: customerRow } = await supabase
    .from('customers')
    .select('id, name, phone, email')
    .eq('id', appointment.customer_id)
    .maybeSingle()
  const customer = customerRow as Pick<Customer, 'id' | 'name' | 'phone' | 'email'> | null
  if (!customer) return null

  let serviceName: string | null = null
  if (appointment.service_id) {
    const { data: serviceRow } = await supabase
      .from('services')
      .select('name')
      .eq('id', appointment.service_id)
      .maybeSingle()
    serviceName = (serviceRow as { name: string } | null)?.name ?? null
  }

  return { appointment, customer, serviceName }
}

/** Envia o texto ao cliente pelos canais disponíveis; nunca lança — falha vira system_event. */
async function sendCustomerMessage(
  supabase: SupabaseClient,
  params: { unit: Unit; customer: Pick<Customer, 'phone' | 'email'>; text: string; eventType: string; appointmentId: string }
): Promise<void> {
  const { unit, customer, text, eventType, appointmentId } = params
  try {
    const attempts = await sendToLeadChannels({ unit, lead: customer, text })
    if (attempts.length === 0) {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'scheduling',
        eventType: `${eventType}_no_channel`,
        message: `Agendamento ${appointmentId}: cliente sem telefone/e-mail utilizável ou canal da unidade não configurado — aviso automático não foi enviado.`,
        orgId: unit.org_id,
        unitId: unit.id,
      })
      return
    }
    const failed = attempts.filter((a) => !a.ok)
    if (failed.length > 0) {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'scheduling',
        eventType: `${eventType}_send_failed`,
        message: `Agendamento ${appointmentId}: falha ao enviar aviso automático por ${failed.map((f) => f.channel).join(', ')}.`,
        orgId: unit.org_id,
        unitId: unit.id,
        metadata: { failures: failed },
      })
    }
  } catch (error) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'scheduling',
      eventType: `${eventType}_error`,
      message: `Agendamento ${appointmentId}: erro inesperado ao enviar aviso automático: ${error instanceof Error ? error.message : String(error)}.`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
  }
}

/** Dispara ao criar um agendamento (booking). Respeita scheduling_settings.confirmation_enabled. */
export async function handleAppointmentBooked(
  supabase: SupabaseClient,
  params: { appointmentId: string; unit: Unit },
): Promise<void> {
  const { appointmentId, unit } = params
  if (!unit.org_id) return
  if (!getSchedulingSettings(unit).confirmation_enabled) return

  const ctx = await loadAppointmentContext(supabase, appointmentId)
  if (!ctx) return
  if (ctx.appointment.confirmation_sent_at) return // idempotência: já notificado

  const locale = unitDefaultLocale(unit)
  const when = fmtMoment(ctx.appointment.starts_at, unit.timezone, locale)
  const text = bookedMessage(ctx.customer.name, unit.name, when, ctx.serviceName, locale)

  await sendCustomerMessage(supabase, {
    unit,
    customer: ctx.customer,
    text,
    eventType: 'appointment_confirmation',
    appointmentId,
  })

  await supabase
    .from('appointments')
    .update({ confirmation_sent_at: new Date().toISOString() })
    .eq('id', appointmentId)
}

/** Dispara ao reagendar (starts_at/ends_at mudou). appointment-form-modal.tsx reseta rescheduled_notified_at para null a cada reagendamento. */
export async function handleAppointmentRescheduled(
  supabase: SupabaseClient,
  params: { appointmentId: string; unit: Unit },
): Promise<void> {
  const { appointmentId, unit } = params
  if (!unit.org_id) return

  const ctx = await loadAppointmentContext(supabase, appointmentId)
  if (!ctx) return
  if (ctx.appointment.rescheduled_notified_at) return // idempotência: já notificado para este horário

  const locale = unitDefaultLocale(unit)
  const when = fmtMoment(ctx.appointment.starts_at, unit.timezone, locale)
  const text = rescheduledMessage(ctx.customer.name, unit.name, when, ctx.serviceName, locale)

  await sendCustomerMessage(supabase, {
    unit,
    customer: ctx.customer,
    text,
    eventType: 'appointment_reschedule',
    appointmentId,
  })

  await supabase
    .from('appointments')
    .update({ rescheduled_notified_at: new Date().toISOString() })
    .eq('id', appointmentId)
}

/** Dispara quando o status vira 'cancelled'. Cancelamento é terminal na UI atual — sem reset do carimbo. */
export async function handleAppointmentCancelled(
  supabase: SupabaseClient,
  params: { appointmentId: string; unit: Unit },
): Promise<void> {
  const { appointmentId, unit } = params
  if (!unit.org_id) return

  const ctx = await loadAppointmentContext(supabase, appointmentId)
  if (!ctx) return
  if (ctx.appointment.cancelled_notified_at) return // idempotência

  const locale = unitDefaultLocale(unit)
  const when = fmtMoment(ctx.appointment.starts_at, unit.timezone, locale)
  const text = cancelledMessage(ctx.customer.name, unit.name, when, ctx.serviceName, locale)

  await sendCustomerMessage(supabase, {
    unit,
    customer: ctx.customer,
    text,
    eventType: 'appointment_cancellation',
    appointmentId,
  })

  await supabase
    .from('appointments')
    .update({ cancelled_notified_at: new Date().toISOString() })
    .eq('id', appointmentId)
}

/**
 * Dispara pelo cron de lembrete (Fase 2, sub-etapa 6/7 — ver
 * api/cron/appointment-reminders). Diferente dos outros 3 handlers,
 * que reagem a um evento imediato (criar/reagendar/cancelar), este é
 * chamado pelo cron já tendo decidido QUANDO lembrar (comparando
 * scheduling_settings.reminder_hours_before com o horário atual) — este
 * handler só cuida de respeitar reminders_enabled, montar a mensagem e
 * garantir idempotência via reminder_sent_at.
 */
export async function handleAppointmentReminder(
  supabase: SupabaseClient,
  params: { appointmentId: string; unit: Unit },
): Promise<void> {
  const { appointmentId, unit } = params
  if (!unit.org_id) return
  if (!getSchedulingSettings(unit).reminders_enabled) return

  const ctx = await loadAppointmentContext(supabase, appointmentId)
  if (!ctx) return
  if (ctx.appointment.reminder_sent_at) return // idempotência: já lembrado

  const locale = unitDefaultLocale(unit)
  const when = fmtMoment(ctx.appointment.starts_at, unit.timezone, locale)
  const text = reminderMessage(ctx.customer.name, unit.name, when, ctx.serviceName, locale)

  await sendCustomerMessage(supabase, {
    unit,
    customer: ctx.customer,
    text,
    eventType: 'appointment_reminder',
    appointmentId,
  })

  await supabase
    .from('appointments')
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq('id', appointmentId)
}

/**
 * Aviso "estamos a caminho" (migration 030) — disparado por ação humana
 * no calendário no dia do serviço (botão "Avisar a caminho"), não por
 * cron: quem sabe que o técnico saiu é a operação, não o relógio.
 * Idempotente via on_my_way_sent_at. Inclui o nome do profissional e o
 * endereço do atendimento quando existirem.
 */
export async function handleAppointmentOnMyWay(
  supabase: SupabaseClient,
  params: { appointmentId: string; unit: Unit },
): Promise<void> {
  const { appointmentId, unit } = params
  if (!unit.org_id) return

  const ctx = await loadAppointmentContext(supabase, appointmentId)
  if (!ctx) return
  if (ctx.appointment.on_my_way_sent_at) return // idempotência: já avisado

  let employeeName: string | null = null
  if (ctx.appointment.employee_id) {
    const { data: employeeRow } = await supabase
      .from('employees')
      .select('name')
      .eq('id', ctx.appointment.employee_id)
      .maybeSingle()
    employeeName = (employeeRow as { name: string } | null)?.name ?? null
  }

  const locale = unitDefaultLocale(unit)
  const time = new Date(ctx.appointment.starts_at).toLocaleTimeString(locale === 'en' ? 'en-US' : 'pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: unit.timezone,
    hour12: locale === 'en',
  })
  const text = onMyWayMessage({
    customerName: ctx.customer.name,
    unitName: unit.name,
    time,
    serviceName: ctx.serviceName,
    employeeName,
    address: ctx.appointment.address,
    locale,
  })

  await sendCustomerMessage(supabase, {
    unit,
    customer: ctx.customer,
    text,
    eventType: 'appointment_on_my_way',
    appointmentId,
  })

  await supabase
    .from('appointments')
    .update({ on_my_way_sent_at: new Date().toISOString() })
    .eq('id', appointmentId)
}

/**
 * Dispara quando o status vira 'no_show'. Decisão conservadora (não
 * coberta no plano): só notificação interna em system_events, sem
 * mensagem automática ao cliente — ver comentário no topo do arquivo.
 */
export async function handleAppointmentNoShow(
  supabase: SupabaseClient,
  params: { appointmentId: string; unit: Unit },
): Promise<void> {
  const { appointmentId, unit } = params
  if (!unit.org_id) return

  const ctx = await loadAppointmentContext(supabase, appointmentId)
  if (!ctx) return
  if (ctx.appointment.no_show_notified_at) return // idempotência

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'scheduling',
    eventType: 'appointment_no_show',
    message: `${ctx.customer.name} não compareceu ao agendamento na ${unit.name}${ctx.serviceName ? ` (${ctx.serviceName})` : ''}.`,
    orgId: unit.org_id,
    unitId: unit.id,
  })

  await supabase
    .from('appointments')
    .update({ no_show_notified_at: new Date().toISOString() })
    .eq('id', appointmentId)
}
