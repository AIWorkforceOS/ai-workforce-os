import { describe, expect, it } from 'vitest'
import { buildFacilitAppointmentInsertRow, FACILIT_SYNC_SOURCE, FACILIT_CUSTOMER_COMPANY_NAME } from '../facilit-appointment'
import type { MappedFacilitOrder } from '../facilit'

// buildFacilitAppointmentInsertRow (2026-09-15): ordem importada da
// Facil-IT vira um appointment real na Agenda — diferente do Portal
// 360 (só o dia, hora sempre placeholder), a Facil-IT já manda data E
// hora reais da visita, usadas direto como starts_at. Também guarda o
// escopo original em inglês (pro cliente, na loja) separado do resumo
// em português gerado por IA (pro técnico, no Portal do Funcionário).

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

function build(order = makeOrder(), summaryPt: string | null = null) {
  return buildFacilitAppointmentInsertRow({ order, customer, timezone: 'America/Phoenix', summaryPt })
}

describe('buildFacilitAppointmentInsertRow', () => {
  it('usa a data/hora real da visita como starts_at (não é placeholder)', () => {
    const row = build()
    expect(row.starts_at).toBe('2026-09-14T16:00:00.000Z')
    expect(row.ends_at).toBe('2026-09-14T17:00:00.000Z')
  })

  it('nunca atribui técnico — employee_id sempre null, pro admin escolher na Agenda', () => {
    expect(build().employee_id).toBeNull()
  })

  it('marca o source como FACILIT_SYNC_SOURCE, reconhecido pela Agenda como pendente de atribuição', () => {
    const row = build()
    expect(row.source).toBe(FACILIT_SYNC_SOURCE)
    expect(row.status).toBe('scheduled')
  })

  it('monta o endereço a partir dos campos separados', () => {
    expect(build().address).toBe('4965 W Bell Rd, Glendale, AZ, 85308')
  })

  it('leva os dados da ordem pros campos service_order_*', () => {
    const row = build()
    expect(row.service_order_number).toBe('158725-01')
    expect(row.service_order_priority).toBe('Low')
    expect(row.service_order_order_type).toBe('Door Bell')
    expect(row.service_order_location_name).toBe('Walgreen Drug Store #03049')
    expect(row.service_order_location_phone).toBe('5551234567')
  })

  it('sem endereço nenhum, address fica null', () => {
    const row = build(makeOrder({ address1: null, address2: null, city: null, state: null, zip: null }))
    expect(row.address).toBeNull()
  })

  it('guarda o escopo original em inglês intacto em service_order_scope_en (é o que o cliente vê na loja)', () => {
    const row = build(makeOrder({ scope: 'DOOR BELL NOT WORKING / CHECK WIRING' }))
    expect(row.service_order_scope_en).toBe('DOOR BELL NOT WORKING / CHECK WIRING')
  })

  it('quando a IA gera um resumo em português, ele vai pra service_order_summary_pt e pra notes', () => {
    const row = build(makeOrder(), 'Campainha não funciona. Verificar fiação.')
    expect(row.service_order_summary_pt).toBe('Campainha não funciona. Verificar fiação.')
    expect(row.notes).toBe('Campainha não funciona. Verificar fiação.')
    // o inglês original continua intacto, nunca é sobrescrito pelo resumo
    expect(row.service_order_scope_en).toBe('Doorbell not working.')
  })

  it('sem resumo da IA (falha ou sem chave), summary_pt fica null e notes cai no escopo original', () => {
    const row = build(makeOrder(), null)
    expect(row.service_order_summary_pt).toBeNull()
    expect(row.notes).toBe('Doorbell not working.')
  })

  it('exporta o nome do cliente genérico usado — mesmo já usado pelo Portal 360', () => {
    expect(FACILIT_CUSTOMER_COMPANY_NAME).toBe('360 Service Provider')
  })
})
