import { describe, expect, it } from 'vitest'
import { buildFacilitAppointmentInsertRow, FACILIT_SYNC_SOURCE, FACILIT_CUSTOMER_COMPANY_NAME } from '../facilit-appointment'
import type { MappedFacilitOrder } from '../facilit'

// buildFacilitAppointmentInsertRow (2026-09-15): ordem importada da
// Facil-IT vira um appointment real na Agenda — diferente do Portal
// 360 (só o dia, hora sempre placeholder), a Facil-IT já manda data E
// hora reais da visita, usadas direto como starts_at.

function makeOrder(overrides: Partial<MappedFacilitOrder> = {}): MappedFacilitOrder {
  return {
    facilit_order_number: '158725-01',
    po_number: '211996-01',
    client_po: null,
    company: 'Walgreen Drug Store #03049',
    address1: '4965 W Bell Rd',
    address2: null,
    city: 'Glendale',
    state: 'AZ',
    zip: '85308',
    phone: '5551234567',
    category: 'Electrical',
    order_type: 'Door Bell',
    priority: 'Low',
    status: 'Scheduled',
    requested_at: null,
    visit_date: '2026-09-14T16:00:00.000Z',
    latitude: null,
    longitude: null,
    scope: 'Doorbell not working.',
    raw: {},
    ...overrides,
  }
}

const customer = { id: 'cust-1', unitId: 'unit-1', orgId: 'org-1' }

describe('buildFacilitAppointmentInsertRow', () => {
  it('usa a data/hora real da visita como starts_at (não é placeholder)', () => {
    const row = buildFacilitAppointmentInsertRow({ order: makeOrder(), customer, timezone: 'America/Phoenix' })

    expect(row.starts_at).toBe('2026-09-14T16:00:00.000Z')
    expect(row.ends_at).toBe('2026-09-14T17:00:00.000Z')
  })

  it('nunca atribui técnico — employee_id sempre null, pro admin escolher na Agenda', () => {
    const row = buildFacilitAppointmentInsertRow({ order: makeOrder(), customer, timezone: 'America/Phoenix' })
    expect(row.employee_id).toBeNull()
  })

  it('marca o source como FACILIT_SYNC_SOURCE, reconhecido pela Agenda como pendente de atribuição', () => {
    const row = buildFacilitAppointmentInsertRow({ order: makeOrder(), customer, timezone: 'America/Phoenix' })
    expect(row.source).toBe(FACILIT_SYNC_SOURCE)
    expect(row.status).toBe('scheduled')
  })

  it('monta o endereço a partir dos campos separados', () => {
    const row = buildFacilitAppointmentInsertRow({ order: makeOrder(), customer, timezone: 'America/Phoenix' })
    expect(row.address).toBe('4965 W Bell Rd, Glendale, AZ, 85308')
  })

  it('leva os dados da ordem pros campos service_order_*', () => {
    const row = buildFacilitAppointmentInsertRow({ order: makeOrder(), customer, timezone: 'America/Phoenix' })
    expect(row.service_order_number).toBe('158725-01')
    expect(row.service_order_priority).toBe('Low')
    expect(row.service_order_order_type).toBe('Door Bell')
    expect(row.service_order_location_name).toBe('Walgreen Drug Store #03049')
    expect(row.service_order_location_phone).toBe('5551234567')
  })

  it('sem endereço nenhum, address fica null', () => {
    const row = buildFacilitAppointmentInsertRow({
      order: makeOrder({ address1: null, address2: null, city: null, state: null, zip: null }),
      customer,
      timezone: 'America/Phoenix',
    })
    expect(row.address).toBeNull()
  })

  it('exporta o nome do cliente genérico usado — mesmo já usado pelo Portal 360', () => {
    expect(FACILIT_CUSTOMER_COMPANY_NAME).toBe('360 Service Provider')
  })
})
