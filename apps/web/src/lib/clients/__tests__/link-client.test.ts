import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { linkAppointmentToClient, resolveClientCustomerId } from '../link-client'

describe('resolveClientCustomerId', () => {
  it('reaproveita o cadastro do cliente na unidade (prefere o de mesmo nome)', async () => {
    const fake = createFakeSupabase({
      customers: [
        { id: 'c-loja', unit_id: 'u1', name: 'Loja 12', client_company: 'ACME', created_at: '2026-01-01' },
        { id: 'c-acme', unit_id: 'u1', name: 'ACME', client_company: 'ACME', created_at: '2026-02-01' },
      ],
    })
    const r = await resolveClientCustomerId(fake.supabase, { unitId: 'u1', orgId: 'o1', clientName: ' acme ' })
    expect(r).toEqual({ ok: true, customerId: 'c-acme' })
  })

  it('cria o cadastro quando a unidade ainda não tem o cliente', async () => {
    const fake = createFakeSupabase({ customers: [{ id: 'x', unit_id: 'u2', name: 'ACME', client_company: 'ACME' }] })
    const r = await resolveClientCustomerId(fake.supabase, { unitId: 'u1', orgId: 'o1', clientName: 'ACME' })
    expect(r.ok).toBe(true)
    const created = fake.db.customers!.filter((c) => c.unit_id === 'u1')
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ client_company: 'ACME', source: 'client_profile', org_id: 'o1' })
  })

  it('recusa nome vazio', async () => {
    const r = await resolveClientCustomerId(createFakeSupabase({}).supabase, { unitId: 'u1', orgId: 'o1', clientName: '  ' })
    expect(r.ok).toBe(false)
  })
})

describe('linkAppointmentToClient', () => {
  it('aponta a ordem para o cliente', async () => {
    const fake = createFakeSupabase({
      customers: [{ id: 'c-acme', unit_id: 'u1', name: 'ACME', client_company: 'ACME' }],
      appointments: [{ id: 'a1', unit_id: 'u1', customer_id: 'old' }],
    })
    const r = await linkAppointmentToClient(fake.supabase, { appointmentId: 'a1', unitId: 'u1', orgId: 'o1', clientName: 'ACME' })
    expect(r.ok).toBe(true)
    expect(fake.db.appointments![0]?.customer_id).toBe('c-acme')
  })

  it('falha se a ordem não é da unidade', async () => {
    const fake = createFakeSupabase({
      customers: [{ id: 'c-acme', unit_id: 'u1', name: 'ACME', client_company: 'ACME' }],
      appointments: [{ id: 'a1', unit_id: 'other', customer_id: 'old' }],
    })
    const r = await linkAppointmentToClient(fake.supabase, { appointmentId: 'a1', unitId: 'u1', orgId: 'o1', clientName: 'ACME' })
    expect(r.ok).toBe(false)
  })
})
