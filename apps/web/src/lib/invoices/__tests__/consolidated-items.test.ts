import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { withFreshConsolidatedDescriptions } from '../consolidated-items'

// Achado real (2026-09-01, Vinicius): editou a descrição de um serviço
// avulso ("Compra de Material") depois que ele já tinha sido consolidado
// numa fatura — o PDF/e-mail continuaram mostrando o texto antigo, porque
// consolidated_items é um snapshot congelado no momento da consolidação.

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    consolidated_items: [
      { invoice_id: 'record-1', invoice_number: '25/08/2026', description: '157662', amount: 631.38, due_date: null },
      { invoice_id: 'record-2', invoice_number: '26/08/2026', description: 'Limpeza padrão', amount: 200, due_date: null },
    ],
    ...overrides,
  }
}

describe('withFreshConsolidatedDescriptions', () => {
  it('sem consolidated_items, devolve a fatura sem tocar no banco', async () => {
    const { supabase } = createFakeSupabase({})
    const invoice = { id: 'invoice-1', consolidated_items: null }
    const result = await withFreshConsolidatedDescriptions(supabase, invoice)
    expect(result).toBe(invoice)
  })

  it('sobrescreve a descrição de cada item com o valor ATUAL do service_record correspondente', async () => {
    const { supabase } = createFakeSupabase({
      service_records: [
        { id: 'record-1', invoice_id: 'invoice-1', description: '157662 - Compra de Material' },
        { id: 'record-2', invoice_id: 'invoice-1', description: 'Limpeza padrão' },
      ],
    })
    const invoice = makeInvoice()

    const result = await withFreshConsolidatedDescriptions(supabase, invoice)

    expect(result.consolidated_items).toEqual([
      { invoice_id: 'record-1', invoice_number: '25/08/2026', description: '157662 - Compra de Material', amount: 631.38, due_date: null },
      { invoice_id: 'record-2', invoice_number: '26/08/2026', description: 'Limpeza padrão', amount: 200, due_date: null },
    ])
    // nunca mexe no valor cobrado nem na data — só na descrição
    expect(result.consolidated_items![0]!.amount).toBe(631.38)
  })

  it('mantém o texto do snapshot quando o service_record não existe mais (excluído)', async () => {
    const { supabase } = createFakeSupabase({ service_records: [] })
    const invoice = makeInvoice()

    const result = await withFreshConsolidatedDescriptions(supabase, invoice)

    expect(result.consolidated_items).toEqual(invoice.consolidated_items)
  })

  it('não sobrescreve quando o service_record foi reatribuído a OUTRA fatura (defesa contra vazar dado de outro lugar)', async () => {
    const { supabase } = createFakeSupabase({
      service_records: [{ id: 'record-1', invoice_id: 'outra-fatura', description: 'Descrição de outra fatura' }],
    })
    const invoice = makeInvoice({
      consolidated_items: [{ invoice_id: 'record-1', invoice_number: '25/08/2026', description: '157662', amount: 631.38, due_date: null }],
    })

    const result = await withFreshConsolidatedDescriptions(supabase, invoice)

    expect(result.consolidated_items![0]!.description).toBe('157662')
  })
})
