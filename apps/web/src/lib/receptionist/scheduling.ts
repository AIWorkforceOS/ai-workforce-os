import type { SupabaseClient } from '@supabase/supabase-js'
import { getAvailableSlots, zonedTimeToUtc, type AvailableSlot, type SlotEngineAppointment } from '@/lib/slot-engine'
import { getBusinessHours, getSchedulingSettings } from '@/lib/scheduling'
import { addDays } from '@/lib/calendar-dates'
import { fmtMoment } from '@/lib/scheduling/appointment-notifications'
import type { Locale } from '@/lib/i18n/config'
import type { AppointmentStatus, Service, Unit } from '@/lib/types'
import type { UpcomingAppointment } from './types'

// Agendamento conversacional do Receptionist (Fase 2, sub-etapa que a
// migration 026 deixou reservada como "Fase 3" — aqui, específica pro
// funcionário Receptionist). Reusa o mesmo motor de slots
// (lib/slot-engine.ts) e os mesmos accessors de configuração
// (lib/scheduling.ts) da tela de calendário — nunca reimplementa o
// cálculo de disponibilidade.
//
// Decisão consciente de escopo (limitação, avisada ao Dispatch): sem
// atribuição de profissional/recurso. O agendamento criado/remarcado
// pela conversa sempre fica com employee_id/resource_id nulos —
// campos opcionais no schema (migration 026) — e a checagem de
// colisão/capacidade é feita por unidade+serviço (não por
// profissional). Isso é seguro (nunca deixa dois agendamentos do
// mesmo serviço além da capacidade configurada), mas é mais
// conservador do que a agenda manual: se dois serviços diferentes são
// feitos pela mesma pessoa, a IA não sabe disso e pode oferecer os
// dois no mesmo horário. Atribuir profissional automaticamente por
// conversa fica para quando houver um critério de escolha (rodízio,
// preferência do cliente) — não inventado aqui.

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed']

type UpcomingAppointmentRow = {
  id: string
  starts_at: string
  ends_at: string
  service_id: string | null
  employee_id: string | null
  address: string | null
  services: { name: string } | null
}

/** Próximos agendamentos ativos do cliente (até 5), com o nome do serviço já resolvido — contexto que o motor de conversa injeta no prompt a cada turno. */
export async function loadUpcomingAppointments(
  supabase: SupabaseClient,
  unit: Unit,
  customerId: string,
): Promise<UpcomingAppointment[]> {
  const { data } = await supabase
    .from('appointments')
    .select('id, starts_at, ends_at, service_id, employee_id, address, services(name)')
    .eq('customer_id', customerId)
    .eq('unit_id', unit.id)
    .in('status', ACTIVE_APPOINTMENT_STATUSES)
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(5)

  return ((data as unknown as UpcomingAppointmentRow[] | null) ?? []).map((row) => ({
    id: row.id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    service_id: row.service_id,
    service_name: row.services?.name ?? null,
    employee_id: row.employee_id,
    address: row.address,
  }))
}

export async function loadActiveServices(supabase: SupabaseClient, unit: Unit): Promise<Service[]> {
  const { data } = await supabase.from('services').select('*').eq('unit_id', unit.id).eq('is_active', true).order('name')
  return (data as Service[] | null) ?? []
}

/**
 * Casa o nome de serviço citado em texto livre pelo cliente com o
 * catálogo da unidade: match exato, depois por substring nos dois
 * sentidos, e cai pro único serviço ativo quando a unidade só tem um
 * (caso comum — ver ensureDefaultService) e não há nome nenhum citado.
 */
export function resolveServiceByName(services: Service[], name: string | null | undefined): Service | null {
  const normalized = name?.trim().toLowerCase() ?? ''
  if (normalized) {
    const exact = services.find((s) => s.name.toLowerCase() === normalized)
    if (exact) return exact
    const partial = services.find(
      (s) => s.name.toLowerCase().includes(normalized) || normalized.includes(s.name.toLowerCase()),
    )
    if (partial) return partial
  }
  return services.length === 1 ? services[0]! : null
}

/** Horários livres do serviço num dia (fuso da unidade), excluindo (se houver) o próprio agendamento sendo remarcado da checagem de colisão. */
export async function computeSlotsForService(
  supabase: SupabaseClient,
  unit: Unit,
  service: Service,
  dateStr: string,
  excludeAppointmentId?: string | null,
): Promise<AvailableSlot[]> {
  const dayStartUtc = zonedTimeToUtc(dateStr, '00:00', unit.timezone).toISOString()
  const dayEndUtc = zonedTimeToUtc(addDays(dateStr, 1), '00:00', unit.timezone).toISOString()

  const { data } = await supabase
    .from('appointments')
    .select('id, starts_at, ends_at, status')
    .eq('unit_id', unit.id)
    .eq('service_id', service.id)
    .gte('starts_at', dayStartUtc)
    .lt('starts_at', dayEndUtc)

  type Row = SlotEngineAppointment & { id: string }
  const existingAppointments = ((data as Row[] | null) ?? []).filter((a) => a.id !== excludeAppointmentId)

  return getAvailableSlots({
    date: dateStr,
    timezone: unit.timezone,
    businessHours: getBusinessHours(unit),
    schedulingSettings: getSchedulingSettings(unit),
    service,
    existingAppointments,
  })
}

function localTimeHHMM(iso: string, unit: Unit): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: unit.timezone })
}

/** Acha, entre os slots livres, o que bate com o horário pedido (HH:MM, 24h) pelo cliente. */
export function findSlotAtTime(slots: AvailableSlot[], unit: Unit, desiredTime: string): AvailableSlot | null {
  return slots.find((slot) => localTimeHHMM(slot.starts_at, unit) === desiredTime) ?? null
}

export function listSlotsText(slots: AvailableSlot[], unit: Unit, locale: Locale, max = 6): string {
  if (slots.length === 0) return locale === 'en' ? 'no open times that day' : 'nenhum horário livre nesse dia'
  const times = slots.slice(0, max).map((s) => localTimeHHMM(s.starts_at, unit))
  return times.join(', ')
}

export type ActionOutcome = { context: string }

/** Cancela um agendamento a pedido do cliente na própria conversa. Marca cancelled_notified_at já preenchido: a resposta da IA nesta mensagem já é o aviso, evita duplicar com o aviso automático (lib/scheduling/appointment-notifications.ts). */
export async function executeCancelAppointment(
  supabase: SupabaseClient,
  unit: Unit,
  appointment: UpcomingAppointment,
  locale: Locale,
): Promise<ActionOutcome> {
  const now = new Date().toISOString()
  await supabase
    .from('appointments')
    .update({
      status: 'cancelled',
      cancelled_at: now,
      cancellation_reason: 'Cliente pediu cancelamento na conversa com a recepcionista digital.',
      cancelled_notified_at: now,
    })
    .eq('id', appointment.id)

  const when = fmtMoment(appointment.starts_at, unit.timezone, locale)
  return {
    context:
      locale === 'en'
        ? `Cancelled successfully: ${appointment.service_name ?? 'the appointment'} on ${when}.`
        : `Cancelado com sucesso: ${appointment.service_name ?? 'o agendamento'} em ${when}.`,
  }
}

/** Remarca um agendamento existente para um novo horário já validado como livre. Mesmo raciocínio de idempotência do cancelamento acima para rescheduled_notified_at. */
export async function executeReschedule(
  supabase: SupabaseClient,
  unit: Unit,
  appointment: UpcomingAppointment,
  slot: AvailableSlot,
  locale: Locale,
): Promise<ActionOutcome> {
  const now = new Date().toISOString()
  await supabase
    .from('appointments')
    .update({ starts_at: slot.starts_at, ends_at: slot.ends_at, rescheduled_notified_at: now })
    .eq('id', appointment.id)

  const when = fmtMoment(slot.starts_at, unit.timezone, locale)
  return {
    context:
      locale === 'en'
        ? `Rescheduled successfully: ${appointment.service_name ?? 'the appointment'} is now on ${when}.`
        : `Remarcado com sucesso: ${appointment.service_name ?? 'o agendamento'} agora é em ${when}.`,
  }
}

/** Cria um agendamento novo direto pela conversa. Sem profissional/recurso atribuído — ver nota de escopo no topo do arquivo. */
export async function executeBooking(
  supabase: SupabaseClient,
  unit: Unit,
  customerId: string,
  service: Service,
  slot: AvailableSlot,
  locale: Locale,
): Promise<ActionOutcome> {
  if (!unit.org_id) {
    return { context: locale === 'en' ? 'booking failed: unit without organization' : 'agendamento falhou: unidade sem organização' }
  }

  const now = new Date().toISOString()
  const { error } = await supabase.from('appointments').insert({
    org_id: unit.org_id,
    unit_id: unit.id,
    customer_id: customerId,
    service_id: service.id,
    starts_at: slot.starts_at,
    ends_at: slot.ends_at,
    source: 'receptionist_chat',
    confirmation_sent_at: now,
  })

  if (error) {
    return {
      context:
        locale === 'en'
          ? 'Could not complete the booking (the time may have just been taken) — say you will double-check and confirm shortly.'
          : 'Não consegui concluir o agendamento agora (o horário pode ter sido ocupado no mesmo instante) — diga que vai confirmar em seguida.',
    }
  }

  const when = fmtMoment(slot.starts_at, unit.timezone, locale)
  return {
    context:
      locale === 'en'
        ? `Booking confirmed: ${service.name} on ${when}.`
        : `Agendamento confirmado: ${service.name} em ${when}.`,
  }
}
