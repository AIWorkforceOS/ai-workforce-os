import { describe, expect, it } from 'vitest'
import {
  buildBulkAppointmentInsertRows,
  customerNameForRow,
  extractionToRow,
  validateRowsForCreate,
  type BulkOrderRow,
} from '@/lib/service-orders/bulk-import'
import type { ServiceOrderExtraction } from '@/lib/service-orders/extraction'

const FULL_EXTRACTION: ServiceOrderExtraction = {
  summaryPt: 'Trocar lâmpadas do corredor.',
  scopeEn: 'Replace hallway light bulbs.',
  address: '123 Main St, Phoenix, AZ',
  orderNumber: '132617',
  clientPo: 'CPO-9',
  priority: 'Low',
  orderType: 'Interior',
  ivrPin: '4455',
  locationName: 'PB - Tanger - Loc # 6800',
  locationPhone: '555-0100',
  issuerName: 'Taina Dias',
  issuerEmail: 'taina@360.com',
}

describe('extractionToRow', () => {
  it('preenche todos os campos quando a extração funciona', () => {
    const row = extractionToRow('row-1', 'ordem1.pdf', 'https://files/ordem1.pdf', FULL_EXTRACTION)
    expect(row.extractionFailed).toBe(false)
    expect(row.orderNumber).toBe('132617')
    expect(row.locationName).toBe('PB - Tanger - Loc # 6800')
    expect(row.summaryPt).toBe('Trocar lâmpadas do corredor.')
    // profissional e horário nunca vêm da IA — sempre em branco pra escolha manual
    expect(row.employeeId).toBe('')
    expect(row.time).toBe('')
  })

  it('extração null (upload falhou, sem API key, doc ilegível) nunca bloqueia — linha em branco com extractionFailed', () => {
    const row = extractionToRow('row-2', 'ordem2.pdf', 'https://files/ordem2.pdf', null)
    expect(row.extractionFailed).toBe(true)
    expect(row.orderNumber).toBe('')
    expect(row.summaryPt).toBe('')
    expect(row.fileUrl).toBe('https://files/ordem2.pdf')
  })

  it('extração com failed:true (rota respondeu mas IA não leu o documento) também marca extractionFailed', () => {
    const row = extractionToRow('row-3', 'ordem3.pdf', 'https://files/ordem3.pdf', { ...FULL_EXTRACTION, failed: true })
    expect(row.extractionFailed).toBe(true)
    // mesmo com failed:true, campos parciais que vieram preenchidos não são descartados
    expect(row.orderNumber).toBe('132617')
  })
})

describe('customerNameForRow', () => {
  function row(overrides: Partial<BulkOrderRow>): BulkOrderRow {
    return {
      id: 'r1',
      fileName: 'ordem.pdf',
      fileUrl: 'https://x',
      extractionFailed: false,
      orderNumber: '',
      summaryPt: '',
      scopeEn: '',
      address: '',
      clientPo: '',
      priority: '',
      orderType: '',
      ivrPin: '',
      locationName: '',
      locationPhone: '',
      issuerName: '',
      issuerEmail: '',
      employeeId: '',
      time: '',
      ...overrides,
    }
  }

  it('usa o nome do local quando disponível', () => {
    expect(customerNameForRow(row({ locationName: 'PB - Tanger - Loc # 6800', orderNumber: '1' }))).toBe(
      'PB - Tanger - Loc # 6800'
    )
  })

  it('cai pro número da ordem quando não há local', () => {
    expect(customerNameForRow(row({ orderNumber: '132617' }))).toBe('Ordem 132617')
  })

  it('cai pro nome do arquivo quando a extração falhou totalmente (nunca fica em branco)', () => {
    expect(customerNameForRow(row({ fileName: 'foto-loja.jpg' }))).toBe('foto-loja.jpg')
  })
})

describe('validateRowsForCreate', () => {
  function row(overrides: Partial<BulkOrderRow>): BulkOrderRow {
    return {
      id: 'r1',
      fileName: 'ordem.pdf',
      fileUrl: 'https://x',
      extractionFailed: false,
      orderNumber: '',
      summaryPt: '',
      scopeEn: '',
      address: '',
      clientPo: '',
      priority: '',
      orderType: '',
      ivrPin: '',
      locationName: '',
      locationPhone: '',
      issuerName: '',
      issuerEmail: '',
      employeeId: '',
      time: '',
      ...overrides,
    }
  }

  it('sem erros quando todas as linhas têm profissional e horário', () => {
    const rows = [row({ id: 'a', employeeId: 'emp-1', time: '09:00' }), row({ id: 'b', employeeId: 'emp-2', time: '10:30' })]
    expect(validateRowsForCreate(rows)).toEqual([])
  })

  it('reporta profissional e horário faltando, por linha, sem parar na primeira', () => {
    const rows = [
      row({ id: 'a', fileName: 'ordem-a.pdf', employeeId: '', time: '' }),
      row({ id: 'b', fileName: 'ordem-b.pdf', employeeId: 'emp-1', time: '' }),
    ]
    const errors = validateRowsForCreate(rows)
    expect(errors).toHaveLength(3)
    expect(errors.filter((e) => e.rowId === 'a')).toHaveLength(2)
    expect(errors.filter((e) => e.rowId === 'b')).toHaveLength(1)
  })
})

describe('buildBulkAppointmentInsertRows', () => {
  function row(overrides: Partial<BulkOrderRow>): BulkOrderRow {
    return {
      id: 'r1',
      fileName: 'ordem.pdf',
      fileUrl: 'https://files/ordem.pdf',
      extractionFailed: false,
      orderNumber: '132617',
      summaryPt: 'Resumo PT',
      scopeEn: 'Scope EN',
      address: '123 Main St',
      clientPo: 'CPO-1',
      priority: 'Low',
      orderType: 'Interior',
      ivrPin: '4455',
      locationName: 'Loja X',
      locationPhone: '555-0100',
      issuerName: 'Taina',
      issuerEmail: 'taina@360.com',
      employeeId: 'emp-1',
      time: '09:00',
      ...overrides,
    }
  }

  it('gera um agendamento completo por linha, com todos os campos service_order_* e os horários calculados a partir da duração', () => {
    const rows = [row({ id: 'a', time: '09:00' }), row({ id: 'b', time: '13:00', employeeId: 'emp-2' })]
    const inserted = buildBulkAppointmentInsertRows({
      rows,
      customerIdByRowId: { a: 'cust-a', b: 'cust-b' },
      date: '2026-08-10',
      timezone: 'America/Phoenix',
      durationMinutes: 120,
      orgId: 'org-1',
      unitId: 'unit-1',
      serviceId: 'service-1',
    })

    expect(inserted).toHaveLength(2)
    expect(inserted[0]).toMatchObject({
      org_id: 'org-1',
      unit_id: 'unit-1',
      customer_id: 'cust-a',
      service_id: 'service-1',
      employee_id: 'emp-1',
      address: '123 Main St',
      service_order_file_url: 'https://files/ordem.pdf',
      service_order_number: '132617',
      service_order_summary_pt: 'Resumo PT',
      service_order_scope_en: 'Scope EN',
      service_order_client_po: 'CPO-1',
      service_order_priority: 'Low',
      service_order_order_type: 'Interior',
      service_order_ivr_pin: '4455',
      service_order_location_name: 'Loja X',
      service_order_location_phone: '555-0100',
      service_order_issuer_name: 'Taina',
      service_order_issuer_email: 'taina@360.com',
    })
    // America/Phoenix não observa DST — sempre UTC-7
    expect(inserted[0]!.starts_at).toBe('2026-08-10T16:00:00.000Z')
    // ends_at = starts_at + durationMinutes
    expect(inserted[0]!.ends_at).toBe('2026-08-10T18:00:00.000Z')
    expect(inserted[1]!.employee_id).toBe('emp-2')
    expect(inserted[1]!.customer_id).toBe('cust-b')
  })

  it('campos opcionais em branco viram null, nunca string vazia', () => {
    const rows = [row({ id: 'a', clientPo: '', priority: '', address: '  ' })]
    const inserted = buildBulkAppointmentInsertRows({
      rows,
      customerIdByRowId: { a: 'cust-a' },
      date: '2026-08-10',
      timezone: 'America/Phoenix',
      durationMinutes: 60,
      orgId: 'org-1',
      unitId: 'unit-1',
      serviceId: null,
    })
    expect(inserted[0]!.service_order_client_po).toBeNull()
    expect(inserted[0]!.service_order_priority).toBeNull()
    expect(inserted[0]!.address).toBeNull()
    expect(inserted[0]!.service_id).toBeNull()
  })

  it('lança erro claro se uma linha não tem cliente resolvido (bug de orquestração, nunca deveria chegar aqui)', () => {
    const rows = [row({ id: 'a' })]
    expect(() =>
      buildBulkAppointmentInsertRows({
        rows,
        customerIdByRowId: {},
        date: '2026-08-10',
        timezone: 'America/Phoenix',
        durationMinutes: 60,
        orgId: 'org-1',
        unitId: 'unit-1',
        serviceId: null,
      })
    ).toThrow(/ordem\.pdf/)
  })
})
