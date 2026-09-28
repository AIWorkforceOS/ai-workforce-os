import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../../__tests__/fake-supabase'
import { fetchMonthlyReport, fetchMonthlyTrend, fetchProfessionalReport } from '../queries'

// fetchProfessionalReport/fetchMonthlyReport (2026-09-27, pedido do
// Vinicius, unidade Mawi Pro): contagem de ordens por status vem de
// appointments, valores vêm de service_records — as duas fontes ficam
// separadas de propósito (achado real: só 30 dos 202 service_records da
// Mawi Pro têm appointment_id preenchido, não estão ligados o
// suficiente pra virar uma métrica só). summarizeServiceRecords já é
// testada em service-financials.test.ts — aqui só cobrimos a composição
// (filtro por período/funcionário/mês + contagem por status).

const TIMEZONE = 'America/Phoenix' // UTC-7 fixo, sem DST

describe('fetchProfessionalReport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-27T18:00:00Z')) // ~11h da manhã em Phoenix
  })
  afterEach(() => vi.useRealTimers())

  it('conta ordens por status e soma valores só do profissional e período selecionados', async () => {
    const { supabase } = createFakeSupabase({
      appointments: [
        // dentro dos últimos 30 dias, do profissional certo
        { id: 'a1', unit_id: 'unit-1', employee_id: 'emp-murilo', starts_at: '2026-09-20T12:00:00Z', service_order_status: 'completed' },
        { id: 'a2', unit_id: 'unit-1', employee_id: 'emp-murilo', starts_at: '2026-09-22T12:00:00Z', service_order_status: 'quote' },
        { id: 'a3', unit_id: 'unit-1', employee_id: 'emp-murilo', starts_at: '2026-09-25T12:00:00Z', service_order_status: 'pending' },
        // fora do período (mais de 30 dias atrás)
        { id: 'a4', unit_id: 'unit-1', employee_id: 'emp-murilo', starts_at: '2026-06-01T12:00:00Z', service_order_status: 'completed' },
        // outro profissional — não deve entrar
        { id: 'a5', unit_id: 'unit-1', employee_id: 'emp-outro', starts_at: '2026-09-20T12:00:00Z', service_order_status: 'completed' },
      ],
      service_records: [
        { id: 'sr1', unit_id: 'unit-1', employee_id: 'emp-murilo', service_date: '2026-09-20', amount_charged: 100, amount_due: 40, amount_paid_to_employee: 40, invoice_id: null },
        { id: 'sr2', unit_id: 'unit-1', employee_id: 'emp-murilo', service_date: '2026-09-25', amount_charged: 200, amount_due: 60, amount_paid_to_employee: 0, invoice_id: null },
        // fora do período
        { id: 'sr3', unit_id: 'unit-1', employee_id: 'emp-murilo', service_date: '2026-01-01', amount_charged: 999, amount_due: 999, amount_paid_to_employee: 999, invoice_id: null },
        // outro profissional
        { id: 'sr4', unit_id: 'unit-1', employee_id: 'emp-outro', service_date: '2026-09-20', amount_charged: 500, amount_due: 500, amount_paid_to_employee: 500, invoice_id: null },
      ],
    })

    const report = await fetchProfessionalReport(supabase, 'unit-1', TIMEZONE, { employeeId: 'emp-murilo', status: 'all', days: 30 })

    expect(report.orders).toEqual({ total: 3, pending: 1, completed: 1, quote: 1 })
    expect(report.financials.totalOrdersAmount).toBe(300)
    expect(report.financials.employeePaid).toBe(40)
    expect(report.financials.employeeDue).toBe(60)
  })

  it('filtra por status quando não é "all"', async () => {
    const { supabase } = createFakeSupabase({
      appointments: [
        { id: 'a1', unit_id: 'unit-1', employee_id: 'emp-murilo', starts_at: '2026-09-20T12:00:00Z', service_order_status: 'completed' },
        { id: 'a2', unit_id: 'unit-1', employee_id: 'emp-murilo', starts_at: '2026-09-22T12:00:00Z', service_order_status: 'quote' },
      ],
      service_records: [],
    })

    const report = await fetchProfessionalReport(supabase, 'unit-1', TIMEZONE, { employeeId: 'emp-murilo', status: 'quote', days: 30 })

    expect(report.orders).toEqual({ total: 1, pending: 0, completed: 0, quote: 1 })
  })
})

describe('fetchMonthlyReport', () => {
  it('soma valores/contagens do mês selecionado, calcula crescimento vs mês anterior e clientes únicos', async () => {
    const { supabase } = createFakeSupabase({
      appointments: [
        // setembro/2026
        { id: 'a1', unit_id: 'unit-1', customer_id: 'cust-1', starts_at: '2026-09-05T12:00:00Z', service_order_status: 'completed' },
        { id: 'a2', unit_id: 'unit-1', customer_id: 'cust-1', starts_at: '2026-09-10T12:00:00Z', service_order_status: 'quote' },
        { id: 'a3', unit_id: 'unit-1', customer_id: 'cust-2', starts_at: '2026-09-15T12:00:00Z', service_order_status: 'completed' },
        // agosto/2026 (mês anterior) — não deve contar nas ordens de setembro
        { id: 'a4', unit_id: 'unit-1', customer_id: 'cust-3', starts_at: '2026-08-10T12:00:00Z', service_order_status: 'completed' },
      ],
      service_records: [
        // setembro
        { id: 'sr1', unit_id: 'unit-1', service_date: '2026-09-05', amount_charged: 300, amount_due: 100, amount_paid_to_employee: 100, invoice_id: null },
        { id: 'sr2', unit_id: 'unit-1', service_date: '2026-09-15', amount_charged: 200, amount_due: 50, amount_paid_to_employee: 0, invoice_id: null },
        // agosto (mês anterior — usado só pro cálculo de crescimento)
        { id: 'sr3', unit_id: 'unit-1', service_date: '2026-08-10', amount_charged: 400, amount_due: 100, amount_paid_to_employee: 100, invoice_id: null },
      ],
    })

    const report = await fetchMonthlyReport(supabase, 'unit-1', TIMEZONE, '2026-09')

    expect(report.orders).toEqual({ total: 3, pending: 0, completed: 2, quote: 1 })
    expect(report.financials.totalOrdersAmount).toBe(500) // 300 + 200, agosto não entra
    expect(report.uniqueCustomers).toBe(2) // cust-1 e cust-2 (cust-3 é de agosto)
    // crescimento: (500 - 400) / 400 * 100 = 25%
    expect(report.revenueGrowthPercent).toBeCloseTo(25)
    // ordens atendidas = lançamentos financeiros do mês (sr1+sr2), não appointments — achado real 2026-09-27
    expect(report.realOrderCount).toBe(2)
    expect(report.averageTicket).toBe(250) // 500 / 2
  })

  it('bug real 2026-09-27 (Mawi Pro): "ordens atendidas" tem que vir dos lançamentos financeiros (service_records), não dos appointments — setembro tinha 51 appointments mas 89 lançamentos de verdade', async () => {
    const manyServiceRecords = Array.from({ length: 89 }, (_, i) => ({
      id: `sr-${i}`,
      unit_id: 'unit-1',
      service_date: '2026-09-10',
      amount_charged: 100,
      amount_due: 40,
      amount_paid_to_employee: 0,
      invoice_id: null,
    }))
    const fewAppointments = Array.from({ length: 51 }, (_, i) => ({
      id: `a-${i}`,
      unit_id: 'unit-1',
      customer_id: 'cust-360-service-provider',
      starts_at: '2026-09-10T12:00:00Z',
      service_order_status: 'completed',
    }))
    const { supabase } = createFakeSupabase({ appointments: fewAppointments, service_records: manyServiceRecords })

    const report = await fetchMonthlyReport(supabase, 'unit-1', TIMEZONE, '2026-09')

    expect(report.orders.total).toBe(51) // ordens da Agenda (Facil-IT) — universo mais estreito
    expect(report.realOrderCount).toBe(89) // ordens atendidas de verdade, o número que importa pro relatório
  })

  it('bug real 2026-09-27 (Mawi Pro): ordens da Facil-IT compartilham o mesmo customer_id sintético — conta por loja (service_order_location_name), não por customer_id, quando presente', async () => {
    const { supabase } = createFakeSupabase({
      appointments: [
        {
          id: 'a1',
          unit_id: 'unit-1',
          customer_id: 'cust-360-service-provider',
          service_order_location_name: 'Chandler',
          starts_at: '2026-09-05T12:00:00Z',
          service_order_status: 'completed',
        },
        {
          id: 'a2',
          unit_id: 'unit-1',
          customer_id: 'cust-360-service-provider',
          service_order_location_name: 'Scottsdale',
          starts_at: '2026-09-10T12:00:00Z',
          service_order_status: 'quote',
        },
        // mesma loja de novo — não deve contar duas vezes
        {
          id: 'a3',
          unit_id: 'unit-1',
          customer_id: 'cust-360-service-provider',
          service_order_location_name: 'Chandler',
          starts_at: '2026-09-15T12:00:00Z',
          service_order_status: 'completed',
        },
      ],
      service_records: [],
    })

    const report = await fetchMonthlyReport(supabase, 'unit-1', TIMEZONE, '2026-09')

    expect(report.orders.total).toBe(3)
    expect(report.uniqueCustomers).toBe(2) // Chandler + Scottsdale, não 1 (o customer_id sintético compartilhado)
  })

  it('mês anterior sem nenhum lançamento: crescimento fica null, nunca divide por zero', async () => {
    const { supabase } = createFakeSupabase({
      appointments: [{ id: 'a1', unit_id: 'unit-1', customer_id: 'cust-1', starts_at: '2026-09-05T12:00:00Z', service_order_status: 'completed' }],
      service_records: [{ id: 'sr1', unit_id: 'unit-1', service_date: '2026-09-05', amount_charged: 300, amount_due: 0, amount_paid_to_employee: 0, invoice_id: null }],
    })

    const report = await fetchMonthlyReport(supabase, 'unit-1', TIMEZONE, '2026-09')

    expect(report.revenueGrowthPercent).toBeNull()
    expect(report.revenueGrowthVs6MonthAvgPercent).toBeNull() // nenhum mês anterior tem lançamento nenhum
  })

  it('crescimento vs média dos meses anteriores ignora meses sem nenhuma ordem (negócio não operava ainda) — só a média dos meses ativos', async () => {
    const { supabase } = createFakeSupabase({
      appointments: [],
      service_records: [
        // julho e agosto tiveram ordens; meses antes disso (maio/junho) não têm nenhum lançamento
        { id: 'sr-jul', unit_id: 'unit-1', service_date: '2026-07-10', amount_charged: 100, amount_due: 0, amount_paid_to_employee: 0, invoice_id: null },
        { id: 'sr-ago', unit_id: 'unit-1', service_date: '2026-08-10', amount_charged: 300, amount_due: 0, amount_paid_to_employee: 0, invoice_id: null },
        { id: 'sr-set', unit_id: 'unit-1', service_date: '2026-09-10', amount_charged: 400, amount_due: 0, amount_paid_to_employee: 0, invoice_id: null },
      ],
    })

    const report = await fetchMonthlyReport(supabase, 'unit-1', TIMEZONE, '2026-09')

    // média dos meses ativos anteriores (julho=100, agosto=300) = 200; crescimento = (400-200)/200*100 = 100%
    expect(report.revenueGrowthVs6MonthAvgPercent).toBeCloseTo(100)
  })
})

describe('fetchMonthlyTrend', () => {
  it('devolve os últimos N meses (mais antigo primeiro), com contagem e faturamento reais de cada um', async () => {
    const { supabase } = createFakeSupabase({
      service_records: [
        { id: 'sr1', unit_id: 'unit-1', service_date: '2026-07-05', amount_charged: 100, amount_due: 0, amount_paid_to_employee: 0, invoice_id: null },
        { id: 'sr2', unit_id: 'unit-1', service_date: '2026-08-05', amount_charged: 50, amount_due: 0, amount_paid_to_employee: 0, invoice_id: null },
        { id: 'sr3', unit_id: 'unit-1', service_date: '2026-08-15', amount_charged: 50, amount_due: 0, amount_paid_to_employee: 0, invoice_id: null },
        { id: 'sr4', unit_id: 'unit-1', service_date: '2026-09-05', amount_charged: 200, amount_due: 0, amount_paid_to_employee: 0, invoice_id: null },
      ],
    })

    const trend = await fetchMonthlyTrend(supabase, 'unit-1', '2026-09', 3)

    expect(trend.map((p) => p.month)).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(trend).toEqual([
      { month: '2026-07', orderCount: 1, revenue: 100 },
      { month: '2026-08', orderCount: 2, revenue: 100 },
      { month: '2026-09', orderCount: 1, revenue: 200 },
    ])
  })

  it('mês sem nenhum lançamento aparece com 0 ordens e 0 de receita, nunca some da lista', async () => {
    const { supabase } = createFakeSupabase({ service_records: [] })

    const trend = await fetchMonthlyTrend(supabase, 'unit-1', '2026-09', 3)

    expect(trend).toEqual([
      { month: '2026-07', orderCount: 0, revenue: 0 },
      { month: '2026-08', orderCount: 0, revenue: 0 },
      { month: '2026-09', orderCount: 0, revenue: 0 },
    ])
  })
})
