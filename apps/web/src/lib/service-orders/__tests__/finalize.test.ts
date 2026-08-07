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

describe('buildServiceOrderUpdatePayload', () => {
  it('rejeita status ausente ou inválido', () => {
    const result = buildServiceOrderUpdatePayload({ status: 'in_progress', signedBy: '', partPurchaseLink: '' }, [], [])
    expect(result.ok).toBe(false)
  })

  it('finalizar exige nome de quem assinou', () => {
    const result = buildServiceOrderUpdatePayload({ status: 'completed', signedBy: '  ', partPurchaseLink: '' }, [], [])
    expect(result).toEqual({ ok: false, error: 'Informe o nome de quem assinou para finalizar.' })
  })

  it('finalizar com assinatura monta o payload com signed_by/signed_at e limpa o link de compra', () => {
    const result = buildServiceOrderUpdatePayload(
      { status: 'completed', signedBy: 'Maria Gerente', partPurchaseLink: 'https://loja.com/peca' },
      [],
      [],
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('esperava sucesso')
    expect(result.payload.service_order_status).toBe('completed')
    expect(result.payload.service_order_signed_by).toBe('Maria Gerente')
    expect(typeof result.payload.service_order_signed_at).toBe('string')
    // Link de compra não faz sentido pra um serviço finalizado — sempre limpo.
    expect(result.payload.service_order_part_purchase_link).toBeNull()
  })

  it('cotação não exige assinatura e preserva o link de compra informado', () => {
    const result = buildServiceOrderUpdatePayload(
      { status: 'quote', signedBy: '', partPurchaseLink: '  https://loja.com/peca  ' },
      [],
      [],
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('esperava sucesso')
    expect(result.payload.service_order_status).toBe('quote')
    expect(result.payload.service_order_part_purchase_link).toBe('https://loja.com/peca')
    expect(result.payload.service_order_signed_by).toBeUndefined()
    expect(result.payload.service_order_signed_at).toBeUndefined()
  })

  it('anexa as fotos novas às já existentes, sem substituir', () => {
    const existing = [{ url: 'https://x/1.jpg', uploaded_at: '2026-08-01T10:00:00Z' }]
    const uploaded = [{ url: 'https://x/2.jpg', uploaded_at: '2026-08-06T10:00:00Z' }]
    const result = buildServiceOrderUpdatePayload({ status: 'quote', signedBy: '', partPurchaseLink: '' }, existing, uploaded)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('esperava sucesso')
    expect(result.payload.service_order_photos).toEqual([...existing, ...uploaded])
  })

  it('só os campos da lista de execução da ordem aparecem no payload — nunca reagendamento/reatribuição', () => {
    const result = buildServiceOrderUpdatePayload(
      { status: 'completed', signedBy: 'Maria Gerente', partPurchaseLink: '' },
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
