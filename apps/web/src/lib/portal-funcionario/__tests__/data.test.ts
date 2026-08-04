import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { fetchEmployeePortalData, isOnOrAfterPortalStart, PORTAL_DATA_SINCE } from '../data'

describe('isOnOrAfterPortalStart', () => {
  it('exclui datas anteriores ao corte de agosto/2026', () => {
    expect(isOnOrAfterPortalStart('2026-07-31')).toBe(false)
    expect(isOnOrAfterPortalStart('2026-07-31T23:59:59Z')).toBe(false)
  })

  it('inclui o dia do corte e datas posteriores', () => {
    expect(isOnOrAfterPortalStart(PORTAL_DATA_SINCE)).toBe(true)
    expect(isOnOrAfterPortalStart('2026-08-01T00:00:00Z')).toBe(true)
    expect(isOnOrAfterPortalStart('2026-09-15')).toBe(true)
  })
})

describe('fetchEmployeePortalData', () => {
  it('isola por employee_id — funcionário A não vê agenda/financeiro do funcionário B', async () => {
    const { supabase } = createFakeSupabase({
      appointments: [
        { id: 'appt-a', employee_id: 'emp-a', starts_at: '2026-08-05T13:00:00Z', ends_at: '2026-08-05T14:00:00Z', status: 'scheduled', address: null, notes: null, customers: { name: 'Cliente A' }, services: { name: 'Limpeza' } },
        { id: 'appt-b', employee_id: 'emp-b', starts_at: '2026-08-06T13:00:00Z', ends_at: '2026-08-06T14:00:00Z', status: 'scheduled', address: null, notes: null, customers: { name: 'Cliente B' }, services: { name: 'Limpeza' } },
      ],
      service_records: [
        { id: 'rec-a', employee_id: 'emp-a', service_date: '2026-08-05', description: 'Serviço A', amount_due: 100, payment_status: 'pending', paid_at: null, customers: { name: 'Cliente A' } },
        { id: 'rec-b', employee_id: 'emp-b', service_date: '2026-08-06', description: 'Serviço B', amount_due: 200, payment_status: 'pending', paid_at: null, customers: { name: 'Cliente B' } },
      ],
    })

    const result = await fetchEmployeePortalData(supabase, 'emp-a')

    expect(result.appointments).toHaveLength(1)
    expect(result.appointments[0]!.id).toBe('appt-a')
    expect(result.serviceRecords).toHaveLength(1)
    expect(result.serviceRecords[0]!.id).toBe('rec-a')
  })

  it('não mostra nada anterior a agosto/2026, mesmo pertencendo ao funcionário', async () => {
    const { supabase } = createFakeSupabase({
      appointments: [
        { id: 'appt-old', employee_id: 'emp-a', starts_at: '2026-07-20T13:00:00Z', ends_at: '2026-07-20T14:00:00Z', status: 'completed', address: null, notes: null, customers: null, services: null },
        { id: 'appt-new', employee_id: 'emp-a', starts_at: '2026-08-10T13:00:00Z', ends_at: '2026-08-10T14:00:00Z', status: 'scheduled', address: null, notes: null, customers: null, services: null },
      ],
      service_records: [
        { id: 'rec-old', employee_id: 'emp-a', service_date: '2026-07-20', description: 'Antigo', amount_due: 50, payment_status: 'paid', paid_at: '2026-07-21', customers: null },
        { id: 'rec-new', employee_id: 'emp-a', service_date: '2026-08-10', description: 'Novo', amount_due: 80, payment_status: 'pending', paid_at: null, customers: null },
      ],
    })

    const result = await fetchEmployeePortalData(supabase, 'emp-a')

    expect(result.appointments.map((a) => a.id)).toEqual(['appt-new'])
    expect(result.serviceRecords.map((r) => r.id)).toEqual(['rec-new'])
  })
})
