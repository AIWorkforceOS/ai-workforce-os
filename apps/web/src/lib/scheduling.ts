// ============================================================
// Agenda Inteligente — accessors de configuração (Fase 2, migration 026)
//
// units.business_hours e units.scheduling_settings nascem como jsonb
// vazio no banco; os defaults sensatos vivem AQUI, não no schema.
// Todo código de agenda deve ler a configuração por estes accessors —
// nunca direto do jsonb — para nunca lidar com undefined/parcial.
// ============================================================

import type { SchedulingSettings, Unit, WeeklySchedule } from '@/lib/types'

/** Horário comercial padrão quando a unidade nunca configurou o próprio: seg–sex 09:00–18:00, fim de semana fechado. */
export const DEFAULT_BUSINESS_HOURS: WeeklySchedule = {
  mon: [{ start: '09:00', end: '18:00' }],
  tue: [{ start: '09:00', end: '18:00' }],
  wed: [{ start: '09:00', end: '18:00' }],
  thu: [{ start: '09:00', end: '18:00' }],
  fri: [{ start: '09:00', end: '18:00' }],
}

export const DEFAULT_SCHEDULING_SETTINGS: SchedulingSettings = {
  slot_interval_minutes: 30,
  min_notice_minutes: 120,
  max_advance_days: 60,
  reminder_hours_before: 24,
  confirmation_enabled: true,
  reminders_enabled: true,
}

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  )
}

/**
 * Grade semanal de funcionamento da unidade. Jsonb vazio ou malformado =
 * default seg–sex 09:00–18:00. Quando a unidade configurou a própria grade,
 * ela vale integralmente (dia ausente = fechado de propósito, sem merge
 * com o default).
 */
export function getBusinessHours(
  unit: Pick<Unit, 'business_hours'>
): WeeklySchedule {
  const stored = unit.business_hours
  if (!isNonEmptyObject(stored)) return DEFAULT_BUSINESS_HOURS
  return stored as WeeklySchedule
}

/**
 * Configuração de agenda da unidade com todos os campos garantidos:
 * o jsonb parcial/vazio do banco é mesclado sobre os defaults, então o
 * retorno nunca tem campo undefined.
 */
export function getSchedulingSettings(
  unit: Pick<Unit, 'scheduling_settings'>
): SchedulingSettings {
  const stored = unit.scheduling_settings
  if (!isNonEmptyObject(stored)) return DEFAULT_SCHEDULING_SETTINGS
  return { ...DEFAULT_SCHEDULING_SETTINGS, ...stored }
}
