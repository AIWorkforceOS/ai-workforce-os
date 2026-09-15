import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createFakeSupabase } from './fake-supabase'
import { syncFacilitOrdersForUnit, type FacilitCredentialRow } from '../facilit-sync'
import { FACILIT_SYNC_SOURCE, FACILIT_CUSTOMER_COMPANY_NAME } from '../facilit-appointment'
import type { Unit } from '../types'

// Sync Facil-IT → Agenda (revisado 2026-09-15, pedido do Vinicius: "vai
// direto para a agenda e o cliente consegue designar o trabalho para o
// técnico responsável"): login novo a cada chamada, upsert de dedup em
// facilit_work_orders, e — pra ordem nova — cria o appointment real na
// Agenda (employee_id null, o admin atribui pela tela normal).

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Mawi Pro — Principal',
    slug: 'mawi-pro-principal',
    timezone: 'America/Phoenix',
    is_active: true,
    ...overrides,
  } as Unit
}

function makeCredential(overrides: Partial<FacilitCredentialRow> = {}): FacilitCredentialRow {
  return {
    id: 'cred-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    client_code: 'CC1',
    username: 'user1',
    password: 'secret',
    is_active: true,
    ...overrides,
  }
}

describe('syncFacilitOrdersForUnit', () => {
  const originalFetch = global.fetch
  const NOW = new Date('2026-09-10T18:00:00Z') // ~11h da manhã em Phoenix (sem DST)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    // Sem OPENAI_API_KEY: summarizeFacilitOrderForTechnician nunca chega a
    // chamar fetch, então não interfere no mock de fetch usado pra
    // simular a Facil-IT (login/orders) nestes testes — resumo por IA é
    // coberto à parte em facilit-summary.test.ts.
    vi.stubEnv('OPENAI_API_KEY', '')
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('cria o appointment real na Agenda pra uma ordem nova, sem técnico atribuído', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes('/devices')) return new Response(JSON.stringify({ token: 'tok-123' }), { status: 200 })
      return new Response(
        JSON.stringify([{ orderNumber: '158725-01', company: 'Walgreens', address1: 'Rua X', visitDate: '2026-09-10T20:00:00Z' }]),
        { status: 200 },
      )
    }) as typeof fetch

    const { supabase, db } = createFakeSupabase({
      facilit_credentials: [makeCredential()],
      facilit_work_orders: [],
      customers: [],
      appointments: [],
    })

    const result = await syncFacilitOrdersForUnit(supabase, makeUnit(), makeCredential())

    expect(result).toEqual({ found: 1, imported: 1, error: null, skipped: [] })
    expect(db.appointments).toHaveLength(1)
    expect(db.appointments?.[0]).toMatchObject({
      unit_id: 'unit-1',
      org_id: 'org-1',
      employee_id: null,
      status: 'scheduled',
      source: FACILIT_SYNC_SOURCE,
      service_order_number: '158725-01',
    })
    expect(db.facilit_work_orders?.[0]?.appointment_id).toBe(db.appointments?.[0]?.id)
  })

  it('reaproveita o mesmo cliente "360 Service Provider" da unidade em vez de criar um novo por ordem', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes('/devices')) return new Response(JSON.stringify({ token: 'tok-123' }), { status: 200 })
      return new Response(
        JSON.stringify([
          { orderNumber: '1', company: 'Loja A', visitDate: '2026-09-10T20:00:00Z' },
          { orderNumber: '2', company: 'Loja B', visitDate: '2026-09-10T21:00:00Z' },
        ]),
        { status: 200 },
      )
    }) as typeof fetch

    const { supabase, db } = createFakeSupabase({
      facilit_credentials: [makeCredential()],
      facilit_work_orders: [],
      customers: [],
      appointments: [],
    })

    await syncFacilitOrdersForUnit(supabase, makeUnit(), makeCredential())

    const facilitCustomers = (db.customers ?? []).filter((c) => c.client_company === FACILIT_CUSTOMER_COMPANY_NAME)
    expect(facilitCustomers).toHaveLength(1)
    expect(db.appointments).toHaveLength(2)
    expect(db.appointments?.every((a) => a.customer_id === facilitCustomers[0]?.id)).toBe(true)
  })

  it('reimportar a mesma ordem não cria um segundo appointment nem mexe no que já existe', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes('/devices')) return new Response(JSON.stringify({ token: 'tok-123' }), { status: 200 })
      return new Response(JSON.stringify([{ orderNumber: '158725-01', status: 'In Progress', visitDate: '2026-09-10T20:00:00Z' }]), {
        status: 200,
      })
    }) as typeof fetch

    const { supabase, db } = createFakeSupabase({
      facilit_credentials: [makeCredential()],
      facilit_work_orders: [
        {
          id: 'wo-1',
          org_id: 'org-1',
          unit_id: 'unit-1',
          facilit_order_number: '158725-01',
          status: 'Scheduled',
          appointment_id: 'appt-existing',
        },
      ],
      customers: [],
      appointments: [{ id: 'appt-existing', unit_id: 'unit-1', org_id: 'org-1', employee_id: 'emp-1', status: 'confirmed' }],
    })

    await syncFacilitOrdersForUnit(supabase, makeUnit(), makeCredential())

    expect(db.appointments).toHaveLength(1)
    expect(db.appointments?.[0]).toMatchObject({ employee_id: 'emp-1', status: 'confirmed' })
    expect(db.facilit_work_orders?.[0]).toMatchObject({ status: 'In Progress', appointment_id: 'appt-existing' })
  })

  it('ordem sem orderNumber ou fora de hoje/amanhã aparece em `skipped` em vez de sumir sem explicação (bug real: 5 ordens na Facil-IT, só 4 chegaram na Agenda)', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes('/devices')) return new Response(JSON.stringify({ token: 'tok-123' }), { status: 200 })
      return new Response(
        JSON.stringify([
          { orderNumber: '1', company: 'Loja A', visitDate: '2026-09-10T20:00:00Z' }, // hoje — entra
          { orderNumber: '2', company: 'Loja B', visitDate: '2026-09-20T20:00:00Z' }, // fora do range — some
          { company: 'Loja C, sem número de ordem' }, // sem orderNumber — some
        ]),
        { status: 200 },
      )
    }) as typeof fetch

    const { supabase, db } = createFakeSupabase({
      facilit_credentials: [makeCredential()],
      facilit_work_orders: [],
      customers: [],
      appointments: [],
    })

    const result = await syncFacilitOrdersForUnit(supabase, makeUnit(), makeCredential())

    expect(result.found).toBe(3)
    expect(result.imported).toBe(1)
    expect(result.skipped).toHaveLength(2)
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderNumber: '2', reason: 'fora_de_hoje_amanha' }),
        expect.objectContaining({ orderNumber: null, company: 'Loja C, sem número de ordem', reason: 'sem_numero_ordem' }),
      ]),
    )
    expect(db.system_events?.some((e) => e.event_type === 'facilit_sync_orders_skipped')).toBe(true)
  })

  it('login falhando grava last_sync_error e loga facilit_sync_auth_failed, sem lançar', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 401 })) as typeof fetch

    const { supabase, db } = createFakeSupabase({
      facilit_credentials: [makeCredential()],
      facilit_work_orders: [],
    })

    const result = await syncFacilitOrdersForUnit(supabase, makeUnit(), makeCredential())

    expect(result.imported).toBe(0)
    expect(result.error).toBeTruthy()
    expect(db.facilit_credentials?.[0]?.last_sync_error).toBeTruthy()
    expect(db.system_events?.some((e) => e.event_type === 'facilit_sync_auth_failed')).toBe(true)
  })
})
