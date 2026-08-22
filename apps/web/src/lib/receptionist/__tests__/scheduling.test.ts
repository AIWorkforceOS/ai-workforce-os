import { describe, expect, it } from 'vitest'
import {
  resolveServiceByName,
  findSlotAtTime,
  listSlotsText,
  executeBooking,
  executeCancelAppointment,
  executeReschedule,
} from '@/lib/receptionist/scheduling'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { Service, Unit } from '@/lib/types'
import type { AvailableSlot } from '@/lib/slot-engine'
import type { UpcomingAppointment } from '@/lib/receptionist/types'

// Motor da Recepcionista (engine.ts/scheduling.ts/handoff.ts) não tinha
// NENHUM teste automatizado até agora — cobre aqui a parte determinística
// mais propensa a bug real: casar o nome de serviço citado em texto livre
// pelo cliente com o catálogo, e achar o slot pedido entre os livres. A
// geração de texto (LLM) fica fora de escopo destes testes (ver
// deal-handoff.e2e.test.ts para o padrão de teste que chama a OpenAI de
// verdade).

const unit: Unit = {
  id: 'unit-1',
  org_id: 'org-1',
  name: 'Unidade Teste',
  slug: 'unidade-teste',
  whatsapp_instance_id: null,
  whatsapp_phone: '5511999999999',
  email_from: null,
  email_reply_to: null,
  logo_url: null,
  email_accent_color: null,
  email_footer_note: null,
  region_city: 'São Paulo',
  region_state: 'SP',
  evolution_api_url: null,
  evolution_api_key: null,
  evolution_instance_name: null,
  messaging_channel: null,
  twilio_account_sid: null,
  twilio_auth_token: null,
  twilio_phone_number: null,
  default_conversation_language: null,
  intake_token: null,
  crm_integration_mode: 'native',
  smarter_crm_partner_token: null,
  recruiting_integration_mode: 'native',
  smarter_recruiting_partner_token: null,
  smarter_recruiting_company_id: null,
  smarter_marketing_partner_token: null,
  public_lead_intake_token: null,
  timezone: 'America/Sao_Paulo',
  business_hours: {},
  scheduling_settings: {},
  billing_company_name: null,
  billing_address: null,
  billing_email: null,
  billing_phone: null,
  billing_payment_instructions: null,
  is_active: true,
  created_at: '',
  updated_at: '',
}

function makeService(overrides: Partial<Service>): Service {
  return {
    id: overrides.id ?? 'svc-1',
    org_id: 'org-1',
    unit_id: unit.id,
    name: overrides.name ?? 'Corte de cabelo',
    duration_minutes: 30,
    buffer_minutes: 0,
    capacity_per_slot: 1,
    price: null,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('resolveServiceByName', () => {
  const services = [makeService({ id: 's1', name: 'Corte de cabelo' }), makeService({ id: 's2', name: 'Manicure' })]

  it('casa por nome exato (case-insensitive)', () => {
    expect(resolveServiceByName(services, 'MANICURE')?.id).toBe('s2')
  })

  it('casa por substring nos dois sentidos', () => {
    expect(resolveServiceByName(services, 'corte')?.id).toBe('s1')
    expect(resolveServiceByName(services, 'quero fazer um corte de cabelo bem curto')?.id).toBe('s1')
  })

  it('retorna null quando não bate nada e há mais de um serviço', () => {
    expect(resolveServiceByName(services, 'depilação')).toBeNull()
  })

  it('retorna null quando o nome é vazio/nulo e há mais de um serviço', () => {
    expect(resolveServiceByName(services, null)).toBeNull()
    expect(resolveServiceByName(services, undefined)).toBeNull()
    expect(resolveServiceByName(services, '')).toBeNull()
  })

  it('cai pro único serviço ativo quando a unidade só tem um, mesmo sem nome citado', () => {
    const single = [makeService({ id: 'only', name: 'Estética facial' })]
    expect(resolveServiceByName(single, null)?.id).toBe('only')
    expect(resolveServiceByName(single, 'qualquer coisa não relacionada')?.id).toBe('only')
  })

  it('retorna null quando não há nenhum serviço', () => {
    expect(resolveServiceByName([], 'corte')).toBeNull()
  })
})

describe('findSlotAtTime', () => {
  const slots: AvailableSlot[] = [
    { starts_at: '2026-08-10T13:00:00.000Z', ends_at: '2026-08-10T13:30:00.000Z' }, // 10:00 America/Sao_Paulo
    { starts_at: '2026-08-10T14:00:00.000Z', ends_at: '2026-08-10T14:30:00.000Z' }, // 11:00 America/Sao_Paulo
  ]

  it('acha o slot que bate com o horário local pedido', () => {
    const found = findSlotAtTime(slots, unit, '10:00')
    expect(found?.starts_at).toBe('2026-08-10T13:00:00.000Z')
  })

  it('retorna null quando nenhum slot bate com o horário pedido', () => {
    expect(findSlotAtTime(slots, unit, '15:00')).toBeNull()
  })

  it('retorna null quando não há slots', () => {
    expect(findSlotAtTime([], unit, '10:00')).toBeNull()
  })
})

describe('listSlotsText', () => {
  it('lista os horários em pt-BR separados por vírgula', () => {
    const slots: AvailableSlot[] = [
      { starts_at: '2026-08-10T13:00:00.000Z', ends_at: '2026-08-10T13:30:00.000Z' },
      { starts_at: '2026-08-10T14:00:00.000Z', ends_at: '2026-08-10T14:30:00.000Z' },
    ]
    expect(listSlotsText(slots, unit, 'pt')).toBe('10:00, 11:00')
  })

  it('avisa quando não há horário livre nenhum (pt e en)', () => {
    expect(listSlotsText([], unit, 'pt')).toBe('nenhum horário livre nesse dia')
    expect(listSlotsText([], unit, 'en')).toBe('no open times that day')
  })

  it('limita a quantidade de horários listados (default 6)', () => {
    const slots: AvailableSlot[] = Array.from({ length: 10 }, (_, i) => ({
      starts_at: new Date(Date.UTC(2026, 7, 10, 13 + i, 0, 0)).toISOString(),
      ends_at: new Date(Date.UTC(2026, 7, 10, 13 + i, 30, 0)).toISOString(),
    }))
    const text = listSlotsText(slots, unit, 'pt')
    expect(text.split(', ')).toHaveLength(6)
  })
})

// Fase 7 (guarda contra invenção, docs/ux-audit-fase1-2026-08-19.md):
// nunca confirmar cancelamento/reagendamento sem persistência
// bem-sucedida. Achado ao auditar os 3 irmãos de escrita em
// scheduling.ts — executeBooking já checava o erro do insert;
// executeCancelAppointment e executeReschedule não checavam o do update
// e sempre devolviam "sucesso", incondicionalmente. Corrigido pra seguir
// o mesmo padrão do booking.
describe('executeCancelAppointment / executeReschedule — persistência real antes de confirmar', () => {
  const appointment: UpcomingAppointment = {
    id: 'appt-1',
    starts_at: '2026-08-10T13:00:00.000Z',
    ends_at: '2026-08-10T13:30:00.000Z',
    service_id: 'svc-1',
    service_name: 'Corte de cabelo',
    employee_id: null,
    address: null,
  }
  const slot: AvailableSlot = { starts_at: '2026-08-11T13:00:00.000Z', ends_at: '2026-08-11T13:30:00.000Z' }

  it('cancelamento: quando o UPDATE falha, NÃO diz que cancelou (status "failed", nunca "success")', async () => {
    const { supabase } = createFakeSupabase(
      { appointments: [{ id: 'appt-1', status: 'scheduled' }] },
      { appointments: { update: 'connection reset' } },
    )
    const result = await executeCancelAppointment(supabase, unit, appointment, 'pt')
    expect(result.status).toBe('failed')
    expect(result.context).not.toMatch(/cancelado com sucesso/i)
    expect(result.context).toMatch(/não consegui cancelar/i)
  })

  it('cancelamento: falha grava em system_events (antes não deixava rastro nenhum pro operador)', async () => {
    const { supabase, db } = createFakeSupabase(
      { appointments: [{ id: 'appt-1', status: 'scheduled' }] },
      { appointments: { update: 'connection reset' } },
    )
    await executeCancelAppointment(supabase, unit, appointment, 'pt')
    const events = (db.system_events ?? []) as { event_type: string; level: string; unit_id: string }[]
    expect(events).toHaveLength(1)
    expect(events[0]!.event_type).toBe('scheduling_cancel_failed')
    expect(events[0]!.level).toBe('error')
    expect(events[0]!.unit_id).toBe(unit.id)
  })

  it('cancelamento: quando o UPDATE funciona, confirma normalmente (status "success")', async () => {
    const { supabase, db } = createFakeSupabase({ appointments: [{ id: 'appt-1', status: 'scheduled' }] })
    const result = await executeCancelAppointment(supabase, unit, appointment, 'pt')
    expect(result.status).toBe('success')
    expect(result.context).toMatch(/cancelado com sucesso/i)
    expect((db.appointments?.[0] as { status: string }).status).toBe('cancelled')
    expect(db.system_events ?? []).toHaveLength(0)
  })

  it('reagendamento: quando o UPDATE falha, NÃO diz que remarcou (status "failed")', async () => {
    const { supabase } = createFakeSupabase(
      { appointments: [{ id: 'appt-1', status: 'scheduled' }] },
      { appointments: { update: 'connection reset' } },
    )
    const result = await executeReschedule(supabase, unit, appointment, slot, 'pt')
    expect(result.status).toBe('failed')
    expect(result.context).not.toMatch(/remarcado com sucesso/i)
    expect(result.context).toMatch(/não consegui remarcar/i)
  })

  it('reagendamento: falha grava em system_events', async () => {
    const { supabase, db } = createFakeSupabase(
      { appointments: [{ id: 'appt-1', status: 'scheduled' }] },
      { appointments: { update: 'connection reset' } },
    )
    await executeReschedule(supabase, unit, appointment, slot, 'pt')
    const events = (db.system_events ?? []) as { event_type: string }[]
    expect(events.map((e) => e.event_type)).toEqual(['scheduling_reschedule_failed'])
  })

  it('reagendamento: quando o UPDATE funciona, confirma normalmente (status "success")', async () => {
    const { supabase } = createFakeSupabase({ appointments: [{ id: 'appt-1', status: 'scheduled' }] })
    const result = await executeReschedule(supabase, unit, appointment, slot, 'pt')
    expect(result.status).toBe('success')
    expect(result.context).toMatch(/remarcado com sucesso/i)
  })
})

// Fase 10 (agenda confiável, migration 069): banco ganhou uma trigger que
// barra reserva além da capacidade do serviço (nada impedia isso antes —
// achado ao auditar o agendamento conversacional). A trigger se manifesta
// pro código como um erro no INSERT — este teste confirma que o lado da
// aplicação já reage a esse erro do jeito certo (nunca confirma sem
// persistir), simulando a rejeição sem precisar de Postgres real.
describe('executeBooking — reage certo quando o INSERT falha (ex.: trigger de capacidade do slot)', () => {
  const service = makeService({})
  const slot: AvailableSlot = { starts_at: '2026-08-11T13:00:00.000Z', ends_at: '2026-08-11T13:30:00.000Z' }

  it('quando o INSERT falha (slot já na capacidade máxima), NÃO diz que agendou (status "failed", loga em system_events)', async () => {
    const { supabase, db } = createFakeSupabase(
      {},
      { appointments: { insert: 'appointment_slot_full: este horário já está na capacidade máxima (1) para este serviço' } },
    )
    const result = await executeBooking(supabase, unit, 'cust-1', service, slot, 'pt')
    expect(result.status).toBe('failed')
    expect(result.context).not.toMatch(/agendamento confirmado/i)
    expect(result.context).toMatch(/não consegui concluir/i)
    const events = (db.system_events ?? []) as { event_type: string }[]
    expect(events.map((e) => e.event_type)).toEqual(['scheduling_booking_failed'])
  })

  it('quando o INSERT funciona, confirma normalmente (status "success", nada em system_events)', async () => {
    const { supabase, db } = createFakeSupabase({})
    const result = await executeBooking(supabase, unit, 'cust-1', service, slot, 'pt')
    expect(result.status).toBe('success')
    expect(result.context).toMatch(/agendamento confirmado/i)
    expect(db.system_events ?? []).toHaveLength(0)
  })
})
