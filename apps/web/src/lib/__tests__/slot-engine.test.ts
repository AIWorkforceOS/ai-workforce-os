import { describe, expect, it } from 'vitest'
import {
  getAvailableSlots,
  getAvailableSlotsForRange,
  localDateString,
  zonedTimeToUtc,
  type SlotEngineAppointment,
} from '../slot-engine'
import type { SchedulingSettings, WeeklySchedule } from '../types'

const BUSINESS_HOURS_SP: WeeklySchedule = {
  mon: [{ start: '09:00', end: '18:00' }],
  tue: [{ start: '09:00', end: '18:00' }],
  wed: [{ start: '09:00', end: '18:00' }],
  thu: [{ start: '09:00', end: '18:00' }],
  fri: [{ start: '09:00', end: '18:00' }],
}

const SETTINGS: SchedulingSettings = {
  slot_interval_minutes: 30,
  min_notice_minutes: 60,
  max_advance_days: 60,
  reminder_hours_before: 24,
  confirmation_enabled: true,
  reminders_enabled: true,
}

const SERVICE_60MIN = { duration_minutes: 60, buffer_minutes: 0, capacity_per_slot: 1 }

// 2026-07-20 é uma segunda-feira.
const MONDAY = '2026-07-20'
const NOW_MONDAY_EARLY = zonedTimeToUtc(MONDAY, '07:00', 'America/Sao_Paulo')

describe('getAvailableSlots — dia cheio, sem agendamentos', () => {
  it('gera todos os slots de 09:00 a 17:00 (última janela que cabe 60min antes de 18:00)', () => {
    const slots = getAvailableSlots({
      date: MONDAY,
      timezone: 'America/Sao_Paulo',
      businessHours: BUSINESS_HOURS_SP,
      schedulingSettings: SETTINGS,
      service: SERVICE_60MIN,
      existingAppointments: [],
      now: NOW_MONDAY_EARLY,
    })

    expect(slots.length).toBe(17) // 09:00, 09:30, ..., 17:00
    expect(slots[0]!.starts_at).toBe(zonedTimeToUtc(MONDAY, '09:00', 'America/Sao_Paulo').toISOString())
    expect(slots[0]!.ends_at).toBe(zonedTimeToUtc(MONDAY, '10:00', 'America/Sao_Paulo').toISOString())
    expect(slots.at(-1)!.starts_at).toBe(
      zonedTimeToUtc(MONDAY, '17:00', 'America/Sao_Paulo').toISOString()
    )
  })

  it('dia sem expediente (sábado) não gera slots', () => {
    const slots = getAvailableSlots({
      date: '2026-07-25', // sábado
      timezone: 'America/Sao_Paulo',
      businessHours: BUSINESS_HOURS_SP,
      schedulingSettings: SETTINGS,
      service: SERVICE_60MIN,
      existingAppointments: [],
      now: NOW_MONDAY_EARLY,
    })
    expect(slots).toEqual([])
  })
})

describe('getAvailableSlots — agendamento no meio do dia', () => {
  it('remove o slot ocupado e os slots que colidiriam com ele', () => {
    const existing: SlotEngineAppointment[] = [
      {
        starts_at: zonedTimeToUtc(MONDAY, '12:00', 'America/Sao_Paulo').toISOString(),
        ends_at: zonedTimeToUtc(MONDAY, '13:00', 'America/Sao_Paulo').toISOString(),
        status: 'confirmed',
      },
    ]

    const slots = getAvailableSlots({
      date: MONDAY,
      timezone: 'America/Sao_Paulo',
      businessHours: BUSINESS_HOURS_SP,
      schedulingSettings: SETTINGS,
      service: SERVICE_60MIN,
      existingAppointments: existing,
      now: NOW_MONDAY_EARLY,
    })

    const starts = slots.map((s) => s.starts_at)
    // 11:30 colide (11:30-12:30 sobrepõe 12:00-13:00), 12:00 é o próprio agendamento,
    // 12:30 colide (12:30-13:30 sobrepõe 12:00-13:00). 13:00 já está livre de novo.
    expect(starts).not.toContain(
      zonedTimeToUtc(MONDAY, '11:30', 'America/Sao_Paulo').toISOString()
    )
    expect(starts).not.toContain(
      zonedTimeToUtc(MONDAY, '12:00', 'America/Sao_Paulo').toISOString()
    )
    expect(starts).not.toContain(
      zonedTimeToUtc(MONDAY, '12:30', 'America/Sao_Paulo').toISOString()
    )
    expect(starts).toContain(zonedTimeToUtc(MONDAY, '13:00', 'America/Sao_Paulo').toISOString())
    expect(starts).toContain(zonedTimeToUtc(MONDAY, '11:00', 'America/Sao_Paulo').toISOString())
  })

  it('cancelado/no_show não bloqueia o horário', () => {
    const existing: SlotEngineAppointment[] = [
      {
        starts_at: zonedTimeToUtc(MONDAY, '12:00', 'America/Sao_Paulo').toISOString(),
        ends_at: zonedTimeToUtc(MONDAY, '13:00', 'America/Sao_Paulo').toISOString(),
        status: 'cancelled',
      },
    ]

    const slots = getAvailableSlots({
      date: MONDAY,
      timezone: 'America/Sao_Paulo',
      businessHours: BUSINESS_HOURS_SP,
      schedulingSettings: SETTINGS,
      service: SERVICE_60MIN,
      existingAppointments: existing,
      now: NOW_MONDAY_EARLY,
    })

    expect(slots.map((s) => s.starts_at)).toContain(
      zonedTimeToUtc(MONDAY, '12:00', 'America/Sao_Paulo').toISOString()
    )
  })
})

describe('getAvailableSlots — capacidade > 1', () => {
  const service = { duration_minutes: 60, buffer_minutes: 0, capacity_per_slot: 3 }

  it('permite reservas simultâneas no mesmo horário até a capacidade', () => {
    const sameSlot = zonedTimeToUtc(MONDAY, '10:00', 'America/Sao_Paulo').toISOString()
    const sameSlotEnd = zonedTimeToUtc(MONDAY, '11:00', 'America/Sao_Paulo').toISOString()
    const existing: SlotEngineAppointment[] = [
      { starts_at: sameSlot, ends_at: sameSlotEnd, status: 'confirmed' },
      { starts_at: sameSlot, ends_at: sameSlotEnd, status: 'confirmed' },
    ]

    const slots = getAvailableSlots({
      date: MONDAY,
      timezone: 'America/Sao_Paulo',
      businessHours: BUSINESS_HOURS_SP,
      schedulingSettings: SETTINGS,
      service,
      existingAppointments: existing,
      now: NOW_MONDAY_EARLY,
    })

    // 2 de 3 vagas ocupadas — o slot ainda aparece disponível.
    expect(slots.map((s) => s.starts_at)).toContain(sameSlot)
  })

  it('bloqueia o slot quando a capacidade se esgota', () => {
    const sameSlot = zonedTimeToUtc(MONDAY, '10:00', 'America/Sao_Paulo').toISOString()
    const sameSlotEnd = zonedTimeToUtc(MONDAY, '11:00', 'America/Sao_Paulo').toISOString()
    const existing: SlotEngineAppointment[] = [
      { starts_at: sameSlot, ends_at: sameSlotEnd, status: 'confirmed' },
      { starts_at: sameSlot, ends_at: sameSlotEnd, status: 'confirmed' },
      { starts_at: sameSlot, ends_at: sameSlotEnd, status: 'confirmed' },
    ]

    const slots = getAvailableSlots({
      date: MONDAY,
      timezone: 'America/Sao_Paulo',
      businessHours: BUSINESS_HOURS_SP,
      schedulingSettings: SETTINGS,
      service,
      existingAppointments: existing,
      now: NOW_MONDAY_EARLY,
    })

    expect(slots.map((s) => s.starts_at)).not.toContain(sameSlot)
  })
})

describe('getAvailableSlots — buffer entre agendamentos', () => {
  it('bloqueia slots dentro da janela de buffer após um agendamento existente', () => {
    const service = { duration_minutes: 30, buffer_minutes: 30, capacity_per_slot: 1 }
    const existing: SlotEngineAppointment[] = [
      {
        starts_at: zonedTimeToUtc(MONDAY, '10:00', 'America/Sao_Paulo').toISOString(),
        ends_at: zonedTimeToUtc(MONDAY, '10:30', 'America/Sao_Paulo').toISOString(),
        status: 'scheduled',
      },
    ]

    const slots = getAvailableSlots({
      date: MONDAY,
      timezone: 'America/Sao_Paulo',
      businessHours: BUSINESS_HOURS_SP,
      schedulingSettings: SETTINGS,
      service,
      existingAppointments: existing,
      now: NOW_MONDAY_EARLY,
    })

    const starts = slots.map((s) => s.starts_at)
    // 10:30 cairia dentro do buffer de 30min após o agendamento (10:00-10:30) — bloqueado.
    expect(starts).not.toContain(zonedTimeToUtc(MONDAY, '10:30', 'America/Sao_Paulo').toISOString())
    // 11:00 já está fora da janela de buffer — livre.
    expect(starts).toContain(zonedTimeToUtc(MONDAY, '11:00', 'America/Sao_Paulo').toISOString())
  })
})

describe('getAvailableSlots — antecedência mínima', () => {
  it('bloqueia slots mais próximos de agora do que min_notice_minutes', () => {
    // "Agora" é 09:30 de segunda, com antecedência mínima de 60min.
    const now = zonedTimeToUtc(MONDAY, '09:30', 'America/Sao_Paulo')

    const slots = getAvailableSlots({
      date: MONDAY,
      timezone: 'America/Sao_Paulo',
      businessHours: BUSINESS_HOURS_SP,
      schedulingSettings: SETTINGS,
      service: SERVICE_60MIN,
      existingAppointments: [],
      now,
    })

    const starts = slots.map((s) => s.starts_at)
    expect(starts).not.toContain(zonedTimeToUtc(MONDAY, '09:00', 'America/Sao_Paulo').toISOString())
    expect(starts).not.toContain(zonedTimeToUtc(MONDAY, '10:00', 'America/Sao_Paulo').toISOString())
    // 10:30 já está a 60min ou mais de 09:30 — disponível.
    expect(starts).toContain(zonedTimeToUtc(MONDAY, '10:30', 'America/Sao_Paulo').toISOString())
  })

  it('data além do horizonte máximo (max_advance_days) não gera slots', () => {
    const slots = getAvailableSlots({
      date: '2026-12-31',
      timezone: 'America/Sao_Paulo',
      businessHours: BUSINESS_HOURS_SP,
      schedulingSettings: SETTINGS,
      service: SERVICE_60MIN,
      existingAppointments: [],
      now: NOW_MONDAY_EARLY,
    })
    expect(slots).toEqual([])
  })

  it('data no passado não gera slots', () => {
    const slots = getAvailableSlots({
      date: '2026-01-01',
      timezone: 'America/Sao_Paulo',
      businessHours: BUSINESS_HOURS_SP,
      schedulingSettings: SETTINGS,
      service: SERVICE_60MIN,
      existingAppointments: [],
      now: NOW_MONDAY_EARLY,
    })
    expect(slots).toEqual([])
  })
})

describe('getAvailableSlots — funcionário com grade própria', () => {
  it('intersecta a grade do funcionário com o horário da unidade', () => {
    const employeeAvailability: WeeklySchedule = {
      mon: [{ start: '14:00', end: '16:00' }], // só tarde, mais restrito que a unidade
    }

    const slots = getAvailableSlots({
      date: MONDAY,
      timezone: 'America/Sao_Paulo',
      businessHours: BUSINESS_HOURS_SP,
      schedulingSettings: SETTINGS,
      service: SERVICE_60MIN,
      employeeAvailability,
      existingAppointments: [],
      now: NOW_MONDAY_EARLY,
    })

    // slot_interval é 30min: 14:00, 14:30 e 15:00 cabem 60min antes do fim às 16:00.
    expect(slots.length).toBe(3)
    expect(slots[0]!.starts_at).toBe(
      zonedTimeToUtc(MONDAY, '14:00', 'America/Sao_Paulo').toISOString()
    )
  })

  it('dia ausente na grade do funcionário (já configurada) = indisponível, sem herdar a unidade', () => {
    const employeeAvailability: WeeklySchedule = {
      tue: [{ start: '09:00', end: '18:00' }], // segunda ausente de propósito
    }

    const slots = getAvailableSlots({
      date: MONDAY,
      timezone: 'America/Sao_Paulo',
      businessHours: BUSINESS_HOURS_SP,
      schedulingSettings: SETTINGS,
      service: SERVICE_60MIN,
      employeeAvailability,
      existingAppointments: [],
      now: NOW_MONDAY_EARLY,
    })

    expect(slots).toEqual([])
  })

  it('grade do funcionário vazia = segue integralmente o horário da unidade', () => {
    const slots = getAvailableSlots({
      date: MONDAY,
      timezone: 'America/Sao_Paulo',
      businessHours: BUSINESS_HOURS_SP,
      schedulingSettings: SETTINGS,
      service: SERVICE_60MIN,
      employeeAvailability: {},
      existingAppointments: [],
      now: NOW_MONDAY_EARLY,
    })

    expect(slots.length).toBe(17)
  })
})

describe('getAvailableSlots — fuso americano', () => {
  const BUSINESS_HOURS_PHX: WeeklySchedule = {
    mon: [{ start: '09:00', end: '17:00' }],
  }

  it('gera slots corretos em America/Phoenix (sem DST, UTC-7 o ano todo)', () => {
    const now = zonedTimeToUtc(MONDAY, '07:00', 'America/Phoenix')

    const slots = getAvailableSlots({
      date: MONDAY,
      timezone: 'America/Phoenix',
      businessHours: BUSINESS_HOURS_PHX,
      schedulingSettings: SETTINGS,
      service: SERVICE_60MIN,
      existingAppointments: [],
      now,
    })

    expect(slots[0]!.starts_at).toBe('2026-07-20T16:00:00.000Z') // 09:00 -07:00 → 16:00 UTC
    expect(slots.at(-1)!.starts_at).toBe('2026-07-20T23:00:00.000Z') // 16:00 -07:00 → 23:00 UTC
  })

  it('America/New_York em julho (EDT, UTC-4) gera offset diferente de Phoenix no mesmo horário local', () => {
    const businessHoursNY: WeeklySchedule = { mon: [{ start: '09:00', end: '17:00' }] }
    const now = zonedTimeToUtc(MONDAY, '07:00', 'America/New_York')

    const slots = getAvailableSlots({
      date: MONDAY,
      timezone: 'America/New_York',
      businessHours: businessHoursNY,
      schedulingSettings: SETTINGS,
      service: SERVICE_60MIN,
      existingAppointments: [],
      now,
    })

    expect(slots[0]!.starts_at).toBe('2026-07-20T13:00:00.000Z') // 09:00 -04:00 (EDT) → 13:00 UTC
  })

  it('appointment armazenado em UTC colide corretamente com o horário local em Phoenix', () => {
    // 10:00 local Phoenix (-07:00) = 17:00 UTC.
    const existing: SlotEngineAppointment[] = [
      { starts_at: '2026-07-20T17:00:00.000Z', ends_at: '2026-07-20T18:00:00.000Z', status: 'confirmed' },
    ]

    const slots = getAvailableSlots({
      date: MONDAY,
      timezone: 'America/Phoenix',
      businessHours: BUSINESS_HOURS_PHX,
      schedulingSettings: SETTINGS,
      service: SERVICE_60MIN,
      existingAppointments: existing,
      now: zonedTimeToUtc(MONDAY, '07:00', 'America/Phoenix'),
    })

    expect(slots.map((s) => s.starts_at)).not.toContain('2026-07-20T17:00:00.000Z')
  })
})

describe('zonedTimeToUtc / localDateString', () => {
  it('é a inversa uma da outra para um instante dado', () => {
    const utc = zonedTimeToUtc('2026-07-20', '09:00', 'America/Sao_Paulo')
    expect(localDateString(utc, 'America/Sao_Paulo')).toBe('2026-07-20')
  })
})

describe('getAvailableSlotsForRange', () => {
  it('retorna um mapa de data → slots cobrindo o intervalo inteiro', () => {
    const result = getAvailableSlotsForRange({
      startDate: MONDAY,
      endDate: '2026-07-21',
      timezone: 'America/Sao_Paulo',
      businessHours: BUSINESS_HOURS_SP,
      schedulingSettings: SETTINGS,
      service: SERVICE_60MIN,
      existingAppointments: [],
      now: NOW_MONDAY_EARLY,
    })

    expect(Object.keys(result)).toEqual(['2026-07-20', '2026-07-21'])
    expect(result['2026-07-20']!.length).toBe(17)
    expect(result['2026-07-21']!.length).toBe(17)
  })
})
