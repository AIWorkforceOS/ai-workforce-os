import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { fetchOperationsData, findMostRecentDataMonth } from '@/lib/operations-queries'

// Reproduz o bug relatado em produção pelo dono do produto: selecionar
// julho/2026 no seletor de mês da tela de Operação não trazia os
// lançamentos reais desse mês (confirmados via SQL em produção: 2
// invoices com reference_month=2026-07-01 e 45 service_records com
// service_date em julho/2026 pra essa unidade). Exercita exatamente a
// mesma função que page.tsx chama pra buscar os dados — se esse teste
// passa, a lógica de query do servidor está correta e o bug real está
// em outro lugar (navegação client-side, ver page.tsx).

function seedData() {
  return {
    service_records: [
      { id: 'rec-jun', unit_id: 'unit-1', service_date: '2026-06-30', amount_charged: 80 },
      { id: 'rec-jul-1', unit_id: 'unit-1', service_date: '2026-07-01', amount_charged: 100 },
      { id: 'rec-jul-2', unit_id: 'unit-1', service_date: '2026-07-31', amount_charged: 120 },
      { id: 'rec-aug', unit_id: 'unit-1', service_date: '2026-08-02', amount_charged: 200 },
      { id: 'rec-other-unit', unit_id: 'unit-2', service_date: '2026-07-15', amount_charged: 999 },
    ],
    invoices: [
      { id: 'inv-jun', unit_id: 'unit-1', reference_month: '2026-06-01', amount: 50, status: 'paid' },
      { id: 'inv-jul', unit_id: 'unit-1', reference_month: '2026-07-01', amount: 450, status: 'draft' },
      { id: 'inv-aug', unit_id: 'unit-1', reference_month: '2026-08-01', amount: 300, status: 'draft' },
    ],
    service_record_payments: [
      { id: 'pay-jul-1', service_record_id: 'rec-jul-1', amount: 40, created_at: '2026-07-05T00:00:00Z' },
      { id: 'pay-jul-2', service_record_id: 'rec-jul-2', amount: 20, created_at: '2026-07-10T00:00:00Z' },
      { id: 'pay-aug', service_record_id: 'rec-aug', amount: 50, created_at: '2026-08-03T00:00:00Z' },
    ],
  }
}

describe('fetchOperationsData', () => {
  it('mês selecionado = julho/2026 devolve só os lançamentos reais de julho (não junho, não agosto, não de outra unidade)', async () => {
    const { supabase } = createFakeSupabase(seedData())

    const { records, invoices } = await fetchOperationsData(supabase, 'unit-1', '2026-07', false)

    expect(records.map((r) => r.id).sort()).toEqual(['rec-jul-1', 'rec-jul-2'])
    expect(invoices.map((i) => i.id)).toEqual(['inv-jul'])
  })

  it('traz o ledger de pagamentos (migration 055) só dos lançamentos do mês filtrado, não de outros meses', async () => {
    const { supabase } = createFakeSupabase(seedData())

    const { payments } = await fetchOperationsData(supabase, 'unit-1', '2026-07', false)

    expect(payments.map((p) => p.id).sort()).toEqual(['pay-jul-1', 'pay-jul-2'])
  })

  it('sem nenhum lançamento no recorte, não tenta buscar pagamentos e devolve lista vazia', async () => {
    const { supabase } = createFakeSupabase(seedData())

    const { records, payments } = await fetchOperationsData(supabase, 'unit-1', '2026-01', false)

    expect(records).toEqual([])
    expect(payments).toEqual([])
  })

  it('mês selecionado = agosto/2026 devolve só agosto', async () => {
    const { supabase } = createFakeSupabase(seedData())

    const { records, invoices } = await fetchOperationsData(supabase, 'unit-1', '2026-08', false)

    expect(records.map((r) => r.id)).toEqual(['rec-aug'])
    expect(invoices.map((i) => i.id)).toEqual(['inv-aug'])
  })

  it('isAllMonths=true devolve junho, julho e agosto juntos — nada foi apagado', async () => {
    const { supabase } = createFakeSupabase(seedData())

    // selectedMonth é ignorado quando isAllMonths — passa um valor
    // qualquer pra deixar claro que ele não deveria influenciar o filtro.
    const { records, invoices } = await fetchOperationsData(supabase, 'unit-1', '2026-08', true)

    expect(records.map((r) => r.id).sort()).toEqual(['rec-aug', 'rec-jul-1', 'rec-jul-2', 'rec-jun'])
    expect(invoices.map((i) => i.id).sort()).toEqual(['inv-aug', 'inv-jul', 'inv-jun'])
  })

  it('nunca traz lançamento de outra unidade, nem filtrado por mês nem em "todo o histórico"', async () => {
    const { supabase } = createFakeSupabase(seedData())

    const julho = await fetchOperationsData(supabase, 'unit-1', '2026-07', false)
    expect(julho.records.some((r) => r.id === 'rec-other-unit')).toBe(false)

    const tudo = await fetchOperationsData(supabase, 'unit-1', '2026-08', true)
    expect(tudo.records.some((r) => r.id === 'rec-other-unit')).toBe(false)
  })
})

describe('findMostRecentDataMonth', () => {
  it('acha o service_date e o reference_month mais recentes da unidade', async () => {
    const { supabase } = createFakeSupabase(seedData())

    const { lastServiceDate, lastReferenceMonth } = await findMostRecentDataMonth(supabase, 'unit-1')

    expect(lastServiceDate).toBe('2026-08-02')
    expect(lastReferenceMonth).toBe('2026-08-01')
  })

  it('sem nenhum lançamento da unidade devolve null pros dois', async () => {
    const { supabase } = createFakeSupabase({ service_records: [], invoices: [] })

    const { lastServiceDate, lastReferenceMonth } = await findMostRecentDataMonth(supabase, 'unit-sem-dado')

    expect(lastServiceDate).toBeNull()
    expect(lastReferenceMonth).toBeNull()
  })
})
