import { describe, expect, it } from 'vitest'
import { buildServiceOrderUpdatePayload, isServiceOrderStatus } from '../finalize'

describe('isServiceOrderStatus', () => {
  it('aceita só "completed" e "quote"', () => {
    expect(isServiceOrderStatus('completed')).toBe(true)
    expect(isServiceOrderStatus('quote')).toBe(true)
    expect(isServiceOrderStatus('pending')).toBe(false)
    expect(isServiceOrderStatus('scheduled')).toBe(false)
    expect(isServiceOrderStatus(undefined)).toBe(false)
    expect(isServiceOrderStatus(null)).toBe(false)
  })
})

const BASE_INPUT = { partPurchaseLink: '', materialDescription: '', materialValue: '', hoursNeeded: '' }

describe('buildServiceOrderUpdatePayload', () => {
  it('rejeita status ausente ou inválido', () => {
    const result = buildServiceOrderUpdatePayload({ status: 'in_progress', signedBy: '', ...BASE_INPUT }, [], [])
    expect(result.ok).toBe(false)
  })

  it('finalizar exige nome de quem assinou', () => {
    const result = buildServiceOrderUpdatePayload({ status: 'completed', signedBy: '  ', ...BASE_INPUT }, [], [])
    expect(result).toEqual({ ok: false, error: 'Informe o nome de quem assinou para finalizar.' })
  })

  it('finalizar com assinatura monta o payload com signed_by/signed_at e limpa o link de compra/material', () => {
    const result = buildServiceOrderUpdatePayload(
      {
        status: 'completed',
        signedBy: 'Maria Gerente',
        partPurchaseLink: 'https://loja.com/peca',
        materialDescription: 'Fechadura nova',
        materialValue: '45.90',
        hoursNeeded: '2.5',
      },
      [],
      [],
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('esperava sucesso')
    expect(result.payload.service_order_status).toBe('completed')
    expect(result.payload.service_order_signed_by).toBe('Maria Gerente')
    expect(typeof result.payload.service_order_signed_at).toBe('string')
    // Link de compra e material não fazem sentido pra um serviço finalizado — sempre limpos.
    expect(result.payload.service_order_part_purchase_link).toBeNull()
    expect(result.payload.service_order_material_description).toBeNull()
    expect(result.payload.service_order_material_value).toBeNull()
    // Horas necessárias é independente do status — nunca é limpo.
    expect(result.payload.service_order_hours_needed).toBe(2.5)
  })

  it('cotação não exige assinatura e preserva link de compra, material, valor e horas informados', () => {
    const result = buildServiceOrderUpdatePayload(
      {
        status: 'quote',
        signedBy: '',
        partPurchaseLink: '  https://loja.com/peca  ',
        materialDescription: '  Fechadura modelo X  ',
        materialValue: '45.9',
        hoursNeeded: '1.5',
      },
      [],
      [],
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('esperava sucesso')
    expect(result.payload.service_order_status).toBe('quote')
    expect(result.payload.service_order_part_purchase_link).toBe('https://loja.com/peca')
    expect(result.payload.service_order_material_description).toBe('Fechadura modelo X')
    expect(result.payload.service_order_material_value).toBe(45.9)
    expect(result.payload.service_order_hours_needed).toBe(1.5)
    expect(result.payload.service_order_signed_by).toBeUndefined()
    expect(result.payload.service_order_signed_at).toBeUndefined()
  })

  it('valor de material e horas inválidos/vazios viram null sem bloquear o salvamento', () => {
    const result = buildServiceOrderUpdatePayload(
      { status: 'quote', signedBy: '', partPurchaseLink: '', materialDescription: '', materialValue: 'abc', hoursNeeded: '' },
      [],
      [],
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('esperava sucesso')
    expect(result.payload.service_order_material_value).toBeNull()
    expect(result.payload.service_order_hours_needed).toBeNull()
  })

  it('anexa as fotos novas às já existentes, sem substituir', () => {
    const existing = [{ url: 'https://x/1.jpg', uploaded_at: '2026-08-01T10:00:00Z' }]
    const uploaded = [{ url: 'https://x/2.jpg', uploaded_at: '2026-08-06T10:00:00Z' }]
    const result = buildServiceOrderUpdatePayload({ status: 'quote', signedBy: '', ...BASE_INPUT }, existing, uploaded)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('esperava sucesso')
    expect(result.payload.service_order_photos).toEqual([...existing, ...uploaded])
  })

  it('sem assinatura nova, mantém a URL da assinatura já salva', () => {
    const result = buildServiceOrderUpdatePayload(
      { status: 'quote', signedBy: '', ...BASE_INPUT },
      [],
      [],
      'https://x/assinatura-antiga.png',
      null,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('esperava sucesso')
    expect(result.payload.service_order_signature_url).toBe('https://x/assinatura-antiga.png')
  })

  it('assinatura nova enviada substitui a anterior', () => {
    const result = buildServiceOrderUpdatePayload(
      { status: 'completed', signedBy: 'Maria Gerente', ...BASE_INPUT },
      [],
      [],
      'https://x/assinatura-antiga.png',
      'https://x/assinatura-nova.png',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('esperava sucesso')
    expect(result.payload.service_order_signature_url).toBe('https://x/assinatura-nova.png')
  })

  it('só os campos da lista de execução da ordem aparecem no payload — nunca reagendamento/reatribuição', () => {
    const result = buildServiceOrderUpdatePayload(
      { status: 'completed', signedBy: 'Maria Gerente', ...BASE_INPUT },
      [],
      [],
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('esperava sucesso')
    const keys = Object.keys(result.payload)
    const forbidden = ['starts_at', 'ends_at', 'employee_id', 'customer_id', 'status', 'unit_id']
    for (const key of forbidden) {
      expect(keys).not.toContain(key)
    }
  })
})
