import type { SupabaseClient } from '@supabase/supabase-js'
import { getAvailableSlots, zonedTimeToUtc, type AvailableSlot, type SlotEngineAppointment } from '@/lib/slot-engine'
import { getBusinessHours, getSchedulingSettings } from '@/lib/scheduling'
import { addDays } from '@/lib/calendar-dates'
import {
  fmtMoment,
  handleAppointmentBooked,
  handleAppointmentCancelled,
  handleAppointmentRescheduled,
} from '@/lib/scheduling/appointment-notifications'
import { logSystemEvent } from '@/lib/system-events'
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
// A REC só oferece horários de profissionais ativos e marcados como
// agendáveis. A grade efetiva é a interseção entre o funcionamento da
// unidade e a disponibilidade individual. Quando existem vínculos de
// serviço por profissional, somente quem executa aquele serviço entra
// na seleção; sem vínculo cadastrado, preservamos compatibilidade e
// consideramos todos os profissionais agendáveis da unidade.

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

export function buildServicesKnowledgeContext(services: Service[]): string {
  if (services.length === 0) {
    return 'CATÁLOGO DE SERVIÇOS: nenhum serviço ativo está cadastrado. Não invente serviço, preço, duração nem disponibilidade; informe que precisa confirmar com a equipe.'
  }
  const rows = services.map((service) => ({
    nome: service.name,
    descricao: service.description,
    preco: service.price,
    observacao_preco: service.price_notes,
    duracao_minutos: service.duration_minutes,
    regras_agendamento: service.booking_rules,
    regras_cancelamento: service.cancellation_rules,
    dados_necessarios: service.customer_requirements,
  }))
  return `CATÁLOGO DE SERVIÇOS — fonte de verdade: ${JSON.stringify(rows)}. Nunca invente ou complete preço, prazo, duração, disponibilidade, promoção ou regra ausente. Se um campo estiver vazio, diga que precisa confirmar.`
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

  const [{ data: employeesData }, { data: skillData }, { data: appointmentsData }] = await Promise.all([
    supabase
      .from('employees')
      .select('id, name, availability')
      .eq('unit_id', unit.id)
      .eq('is_active', true)
      .eq('is_schedulable', true)
      .order('name'),
    supabase
      .from('employee_service_skills')
      .select('employee_id')
      .eq('service_id', service.id),
    supabase
    .from('appointments')
    .select('id, employee_id, starts_at, ends_at, status')
    .eq('unit_id', unit.id)
    .gte('starts_at', dayStartUtc)
      .lt('starts_at', dayEndUtc),
  ])

  type EmployeeRow = { id: string; name: string; availability: Unit['business_hours'] }
  type Row = SlotEngineAppointment & { id: string; employee_id: string | null }
  const employees = (employeesData as EmployeeRow[] | null) ?? []
  const skilledIds = new Set(((skillData as { employee_id: string }[] | null) ?? []).map((row) => row.employee_id))
  const candidates = skilledIds.size > 0 ? employees.filter((employee) => skilledIds.has(employee.id)) : employees
  const appointments = ((appointmentsData as Row[] | null) ?? []).filter((appointment) => appointment.id !== excludeAppointmentId)

  const slots = candidates.flatMap((employee) => {
    const employeeAppointments = appointments.filter((appointment) => appointment.employee_id === employee.id)
    return getAvailableSlots({
      date: dateStr,
      timezone: unit.timezone,
      businessHours: getBusinessHours(unit),
      schedulingSettings: getSchedulingSettings(unit),
      service,
      employeeAvailability: employee.availability,
      existingAppointments: employeeAppointments,
    }).map((slot) => ({ ...slot, employee_id: employee.id, employee_name: employee.name }))
  })

  // Um horário aparece uma vez para o cliente. Se mais de um profissional
  // estiver livre, o desempate por quantidade de compromissos distribui a
  // agenda; nome torna o resultado determinístico em empate.
  return [...slots]
    .sort((a, b) => {
      const loadA = appointments.filter((appointment) => appointment.employee_id === a.employee_id).length
      const loadB = appointments.filter((appointment) => appointment.employee_id === b.employee_id).length
      return a.starts_at.localeCompare(b.starts_at) || loadA - loadB || (a.employee_name ?? '').localeCompare(b.employee_name ?? '')
    })
    .filter((slot, index, all) => index === 0 || all[index - 1]!.starts_at !== slot.starts_at)
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

// Fase 7 (guardas contra invenção, docs/ux-audit-fase1-2026-08-19.md):
// "toda ação operacional deve produzir um resultado estruturado" — antes
// disso, ActionOutcome só tinha `context` (texto livre injetado no prompt),
// sem nenhum campo que o código pudesse checar sem reinterpretar o texto.
// `status` é aditivo: quem já consumia só `.context` (lib/receptionist/
// engine.ts) continua igual; agora dá pra reagir ao resultado sem parsear
// string. Nomenclatura segue exatamente a do briefing (success/failed/
// needs_human/unavailable/needs_confirmation) — as 3 funções abaixo hoje só
// produzem 'success' ou 'failed' (persistência síncrona, sabe na hora se
// deu certo); os outros 3 valores ficam reservados pra fluxos que ainda não
// existem (ex.: uma ação que dependa de confirmação assíncrona).
export type ActionOutcomeStatus = 'success' | 'failed' | 'needs_human' | 'unavailable' | 'needs_confirmation'
export type ActionOutcome = { status: ActionOutcomeStatus; context: string }

/** Loga a falha no mesmo padrão do resto do produto (system_events) — antes desta correção (Fase 7/14) uma falha de agendar/cancelar/remarcar não deixava nenhum rastro visível pro operador, só a mensagem ao cliente. */
async function logSchedulingFailure(
  supabase: SupabaseClient,
  unit: Unit,
  action: 'booking' | 'cancel' | 'reschedule',
  error: unknown,
): Promise<void> {
  await logSystemEvent(supabase, {
    level: 'error',
    source: 'receptionist',
    eventType: `scheduling_${action}_failed`,
    message: `Falha ao ${action === 'booking' ? 'criar agendamento' : action === 'cancel' ? 'cancelar agendamento' : 'remarcar agendamento'} pela conversa na unidade "${unit.name}".`,
    orgId: unit.org_id,
    unitId: unit.id,
    metadata: { error: error instanceof Error ? error.message : String(error) },
  })
}

/** Cancela pela conversa e envia uma cópia por e-mail quando disponível. */
export async function executeCancelAppointment(
  supabase: SupabaseClient,
  unit: Unit,
  appointment: UpcomingAppointment,
  locale: Locale,
): Promise<ActionOutcome> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('appointments')
    .update({
      status: 'cancelled',
      cancelled_at: now,
      cancellation_reason: 'Cliente pediu cancelamento na conversa com a recepcionista digital.',
      cancelled_notified_at: null,
    })
    .eq('id', appointment.id)

  // Guarda contra invenção (Fase 7): nunca confirmar cancelamento sem
  // persistência bem-sucedida — antes desta correção, o "sucesso" era
  // devolvido incondicionalmente, igual ao bug já achado e corrigido no
  // fechamento de negócio do Sales (conversation-engine.ts).
  if (error) {
    await logSchedulingFailure(supabase, unit, 'cancel', error)
    return {
      status: 'failed',
      context:
        locale === 'en'
          ? 'Could not cancel just now — say you will double-check and confirm shortly, never say it was cancelled.'
          : 'Não consegui cancelar agora — diga que vai confirmar em seguida, nunca diga que já foi cancelado.',
    }
  }

  await handleAppointmentCancelled(supabase, { appointmentId: appointment.id, unit, emailOnly: true })

  const when = fmtMoment(appointment.starts_at, unit.timezone, locale)
  return {
    status: 'success',
    context:
      locale === 'en'
        ? `Cancelled successfully: ${appointment.service_name ?? 'the appointment'} on ${when}.`
        : `Cancelado com sucesso: ${appointment.service_name ?? 'o agendamento'} em ${when}.`,
  }
}

/** Remarca um agendamento existente e envia uma cópia por e-mail quando disponível. */
export async function executeReschedule(
  supabase: SupabaseClient,
  unit: Unit,
  appointment: UpcomingAppointment,
  slot: AvailableSlot,
  locale: Locale,
): Promise<ActionOutcome> {
  const { error } = await supabase
    .from('appointments')
    .update({ starts_at: slot.starts_at, ends_at: slot.ends_at, employee_id: slot.employee_id ?? appointment.employee_id, rescheduled_notified_at: null })
    .eq('id', appointment.id)

  // Mesma guarda contra invenção do cancelamento acima: nunca confirmar
  // reagendamento sem persistência bem-sucedida.
  if (error) {
    await logSchedulingFailure(supabase, unit, 'reschedule', error)
    return {
      status: 'failed',
      context:
        locale === 'en'
          ? 'Could not reschedule just now — say you will double-check and confirm shortly, never say it was moved.'
          : 'Não consegui remarcar agora — diga que vai confirmar em seguida, nunca diga que já foi remarcado.',
    }
  }

  await handleAppointmentRescheduled(supabase, { appointmentId: appointment.id, unit, emailOnly: true })

  const when = fmtMoment(slot.starts_at, unit.timezone, locale)
  return {
    status: 'success',
    context:
      locale === 'en'
        ? `Rescheduled successfully: ${appointment.service_name ?? 'the appointment'} is now on ${when}.`
        : `Remarcado com sucesso: ${appointment.service_name ?? 'o agendamento'} agora é em ${when}.`,
  }
}

/** Cria um agendamento novo direto pela conversa, já atribuído ao profissional do slot escolhido. */
export async function executeBooking(
  supabase: SupabaseClient,
  unit: Unit,
  customerId: string,
  service: Service,
  slot: AvailableSlot,
  locale: Locale,
): Promise<ActionOutcome> {
  if (!unit.org_id) {
    return {
      status: 'failed',
      context: locale === 'en' ? 'booking failed: unit without organization' : 'agendamento falhou: unidade sem organização',
    }
  }

  const { data, error } = await supabase.from('appointments').insert({
    org_id: unit.org_id,
    unit_id: unit.id,
    customer_id: customerId,
    service_id: service.id,
    employee_id: slot.employee_id ?? null,
    starts_at: slot.starts_at,
    ends_at: slot.ends_at,
    source: 'receptionist_chat',
    confirmation_sent_at: null,
  }).select('id').single()

  if (error) {
    await logSchedulingFailure(supabase, unit, 'booking', error)
    return {
      status: 'failed',
      context:
        locale === 'en'
          ? 'Could not complete the booking (the time may have just been taken) — say you will double-check and confirm shortly.'
          : 'Não consegui concluir o agendamento agora (o horário pode ter sido ocupado no mesmo instante) — diga que vai confirmar em seguida.',
    }
  }


  const appointmentId = (data as { id?: string } | null)?.id
  if (appointmentId) {
    await handleAppointmentBooked(supabase, { appointmentId, unit, emailOnly: true })
  }

  const when = fmtMoment(slot.starts_at, unit.timezone, locale)
  return {
    status: 'success',
    context:
      locale === 'en'
        ? `Booking confirmed: ${service.name} on ${when}.`
        : `Agendamento confirmado: ${service.name} em ${when}.`,
  }
}
