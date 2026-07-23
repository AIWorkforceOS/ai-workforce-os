import type { Weekday } from '@/lib/types'
import { WEEKDAY_ORDER } from '@/lib/scheduling/recurrence'

/**
 * Recorrência do "serviço contratado" cadastrado no cliente
 * (customers.custom_fields.service_recurrence, modo gestão completa) —
 * mesmo vocabulário de tipos do agendamento (lib/scheduling/recurrence),
 * mas guardada à parte porque descreve o CLIENTE ("como ele costuma
 * contratar"), não um agendamento específico. Serve de valor padrão ao
 * agendar (AppointmentFormModal) e de base pra projeção de receita
 * mensal no financeiro (nenhuma das duas depende da outra existir).
 */
export type ServiceRecurrenceType = 'once' | 'weekly' | 'biweekly' | 'monthly' | 'custom'

export type ServiceRecurrence = {
  type: ServiceRecurrenceType
  /** só relevante quando type === 'custom' — dias da semana atendidos */
  days?: Weekday[]
}

const VALID_TYPES: ServiceRecurrenceType[] = ['once', 'weekly', 'biweekly', 'monthly', 'custom']
const VALID_DAYS = new Set<string>(WEEKDAY_ORDER)

/**
 * Lê customers.custom_fields.service_recurrence de forma tolerante:
 * dado bruto do banco pode ser o formato antigo (string 'once'|'weekly',
 * migration 032) ou o novo objeto ({ type, days? }, migration 035).
 */
export function normalizeServiceRecurrence(raw: unknown): ServiceRecurrence {
  if (typeof raw === 'string') {
    return raw === 'weekly' ? { type: 'weekly' } : { type: 'once' }
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as { type?: unknown; days?: unknown }
    const type = VALID_TYPES.includes(obj.type as ServiceRecurrenceType) ? (obj.type as ServiceRecurrenceType) : 'once'
    if (type !== 'custom') return { type }
    const days = Array.isArray(obj.days) ? (obj.days.filter((d) => VALID_DAYS.has(d as string)) as Weekday[]) : []
    return { type: 'custom', days: days.length > 0 ? days : ['mon'] }
  }
  return { type: 'once' }
}

export function isRecurringService(recurrence: ServiceRecurrence): boolean {
  return recurrence.type !== 'once'
}

/**
 * Quantas vezes por mês o serviço se repete, pra projeção de receita —
 * mesma convenção usada pelo Vinicius ao pedir a funcionalidade: "$80 1x
 * por semana soma $320/mês" (ou seja, 4x/semana no mês, não 4.33x).
 */
export function monthlyOccurrenceMultiplier(recurrence: ServiceRecurrence): number {
  switch (recurrence.type) {
    case 'weekly':
      return 4
    case 'biweekly':
      return 2
    case 'monthly':
      return 1
    case 'custom':
      return 4 * Math.max(1, recurrence.days?.length ?? 1)
    case 'once':
    default:
      return 0
  }
}

/** Projeção de receita mensal de um cliente recorrente = valor da visita × frequência mensal. Cliente não-recorrente ou sem valor cadastrado = 0 (não entra na projeção). */
export function projectedMonthlyRevenue(serviceValue: number | null, recurrence: ServiceRecurrence): number {
  if (serviceValue === null || !Number.isFinite(serviceValue) || serviceValue <= 0) return 0
  return serviceValue * monthlyOccurrenceMultiplier(recurrence)
}
