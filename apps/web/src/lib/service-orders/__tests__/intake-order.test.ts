import { describe, expect, it } from 'vitest'
import { ADMIN_INTAKE_SOURCE, buildIntakeAppointmentRow, emptyIntakeForm, validateIntake } from '../intake-order'

const base = () => ({ ...emptyIntakeForm('2026-10-26'), clientName: 'ACME', description: 'Porta da loja não fecha' })

describe('validateIntake', () => {
  it('exige cliente, data e arquivo ou descrição', () => {
    expect(validateIntake(base())).toBeNull()
    expect(validateIntake({ ...base(), clientName: ' ' })).toMatch(/cliente/i)
    expect(validateIntake({ ...base(), date: '' })).toMatch(/data/i)
    expect(validateIntake({ ...base(), description: '' })).toMatch(/anexe|descrição/i)
    expect(validateIntake({ ...base(), description: '', fileUrl: 'https://x/y.pdf' })).toBeNull()
  })
})

describe('buildIntakeAppointmentRow', () => {
  it('monta ordem sem técnico às 09h do fuso da unidade e guarda análise e fotos', () => {
    const row = buildIntakeAppointmentRow({
      orgId: 'o', unitId: 'u', customerId: 'c', timezone: 'America/New_York', now: new Date('2026-10-25T10:00:00Z'),
      form: { ...base(), photoUrls: ['https://p/1.jpg'], orderNumber: ' 123 ', analysis: { demandPt: 'd', materials: [{ item: 'i', note: null }], scopeIdeaPt: 's', insufficient: false } },
    })
    expect(row).toMatchObject({ source: ADMIN_INTAKE_SOURCE, status: 'scheduled', service_order_number: '123', service_order_summary_pt: 'Porta da loja não fecha', service_order_file_url: null })
    expect(row).not.toHaveProperty('employee_id')
    expect(row.starts_at).toBe('2026-10-26T13:00:00.000Z')
    expect(new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()).toBe(3_600_000)
    expect(row.custom_fields).toMatchObject({ reference_photos: ['https://p/1.jpg'], order_analysis: { demandPt: 'd', generated_at: '2026-10-25T10:00:00.000Z' } })
  })
  it('sem análise nem fotos, custom_fields fica vazio', () => {
    expect(buildIntakeAppointmentRow({ orgId: 'o', unitId: 'u', customerId: 'c', timezone: 'UTC', form: base() }).custom_fields).toEqual({})
  })
})
