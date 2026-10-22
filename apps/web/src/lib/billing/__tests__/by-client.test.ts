import { describe, expect, it } from 'vitest'
import { addDaysIso, canInvoiceSelection, clientNameOf, dueFromTerms, groupByClient, monthSummary, NO_CLIENT_LABEL, remindersFor, totalsOf, type BillingRecord } from '../by-client'

const rec = (over: Partial<BillingRecord> = {}): BillingRecord => ({ id: 'r' + Math.random(), serviceDate: '2026-10-05', amount: 100, dueDate: null, invoiceId: null, invoiceNumber: null, invoiceStatus: null, paid: false, clientName: 'Acme', customerName: 'Loja 1', orderNumber: '1', locationName: null, description: null, ...over })

describe('cliente da ordem', () => {
  it('usa o cliente cadastrado; sem ele, o nome do cadastro; sem nada, "Sem cliente vinculado"', () => {
    expect(clientNameOf({ client_company: '  360  Service Provider ', name: 'Loja 1' })).toBe('360 Service Provider')
    expect(clientNameOf({ client_company: null, name: 'Maria Silva' })).toBe('Maria Silva')
    expect(clientNameOf(null)).toBe(NO_CLIENT_LABEL)
  })
})

describe('vencimento (Net 15/30/45/60 ou livre)', () => {
  it('soma dias ao encerramento, atravessando mês e ano', () => {
    expect(dueFromTerms('2026-10-20', 15)).toBe('2026-11-04')
    expect(dueFromTerms('2026-10-20', 30)).toBe('2026-11-19')
    expect(dueFromTerms('2026-12-20', 45)).toBe('2027-02-03')
    expect(dueFromTerms('2026-01-15', 60)).toBe('2026-03-16')
    expect(dueFromTerms('2026-10-20', 0)).toBe('2026-10-20')
  })
  it('prazo livre qualquer; inválido não sugere nada', () => {
    expect(dueFromTerms('2026-10-20', 7)).toBe('2026-10-27')
    expect(dueFromTerms('2026-10-20', null)).toBeNull()
    expect(dueFromTerms('2026-10-20', -3)).toBeNull()
    expect(dueFromTerms('lixo', 15)).toBeNull()
    expect(addDaysIso('2026-02-27', 2)).toBe('2026-03-01')
  })
})

describe('totais por cliente e do mês', () => {
  const records = [
    rec({ clientName: 'Acme', amount: 100.1 }),
    rec({ clientName: 'Acme', amount: 200.2, invoiceId: 'i1', paid: true }),
    rec({ clientName: 'Beta', amount: 50 }),
    rec({ clientName: NO_CLIENT_LABEL, amount: 10 }),
    rec({ clientName: 'Acme', amount: null }),
  ]
  it('soma em centavos (sem erro de ponto flutuante) separando a faturar, faturado e recebido', () => {
    expect(totalsOf(records.filter((r) => r.clientName === 'Acme'))).toEqual({ count: 3, total: 300.3, toBill: 100.1, billed: 200.2, paid: 200.2 })
  })
  it('um grupo por cliente em ordem alfabética, "Sem cliente vinculado" por último', () => {
    const groups = groupByClient(records)
    expect(groups.map((g) => g.client)).toEqual(['Acme', 'Beta', NO_CLIENT_LABEL])
    expect(groups[0]!.totals.count).toBe(3)
  })
  it('total do mês = soma de todos os clientes', () => {
    const s = monthSummary(records)
    expect(s.totals.total).toBe(360.3)
    expect(s.byClient.reduce((n, c) => Math.round((n + c.totals.total) * 100) / 100, 0)).toBe(360.3)
  })
  it('dentro do cliente: por vencimento (sem vencimento por último), depois pela data do serviço', () => {
    const g = groupByClient([rec({ id: 'a', dueDate: null }), rec({ id: 'b', dueDate: '2026-10-30' }), rec({ id: 'c', dueDate: '2026-10-20' })])[0]!
    expect(g.records.map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('lembretes manuais de envio de invoice', () => {
  const today = '2026-10-20'
  const records = [
    rec({ id: '1', clientName: 'Acme', dueDate: '2026-10-20', amount: 100 }),
    rec({ id: '2', clientName: 'Acme', dueDate: '2026-10-20', amount: 50.5 }),
    rec({ id: '3', clientName: 'Beta', dueDate: '2026-10-21', amount: 70 }),
    rec({ id: '4', clientName: 'Acme', dueDate: '2026-10-18', amount: 30 }),
    rec({ id: '5', clientName: 'Acme', dueDate: '2026-10-25', amount: 99 }),
    rec({ id: '6', clientName: 'Acme', dueDate: '2026-10-20', amount: 10, invoiceId: 'inv' }),
    rec({ id: '7', clientName: 'Acme', dueDate: null, amount: 10 }),
  ]
  it('vence hoje, vence amanhã e atrasadas; agrupado por cliente e data (cada cliente recebe a sua invoice)', () => {
    const groups = remindersFor(records, today)
    expect(groups.map((g) => [g.bucket, g.client, g.dueDate, g.records.length, g.total])).toEqual([
      ['overdue', 'Acme', '2026-10-18', 1, 30],
      ['today', 'Acme', '2026-10-20', 2, 150.5],
      ['tomorrow', 'Beta', '2026-10-21', 1, 70],
    ])
  })
  it('ignora ordem já faturada, sem vencimento, sem valor ou com vencimento mais distante', () => {
    const ids = remindersFor(records, today).flatMap((g) => g.records.map((r) => r.id))
    expect(ids).not.toContain('5')
    expect(ids).not.toContain('6')
    expect(ids).not.toContain('7')
  })
  it('amanhã cruza o fim do mês corretamente', () => {
    expect(remindersFor([rec({ dueDate: '2026-11-01' })], '2026-10-31')[0]!.bucket).toBe('tomorrow')
  })
})

describe('seleção para gerar a invoice', () => {
  it('só um cliente por invoice, sem ordem já faturada e com valor', () => {
    expect(canInvoiceSelection([])).toMatchObject({ ok: false })
    expect(canInvoiceSelection([rec({ clientName: 'A' }), rec({ clientName: 'B' })])).toMatchObject({ ok: false, reason: expect.stringContaining('um cliente só') })
    expect(canInvoiceSelection([rec({ invoiceId: 'x' })])).toMatchObject({ ok: false })
    expect(canInvoiceSelection([rec({ amount: null })])).toMatchObject({ ok: false })
    expect(canInvoiceSelection([rec({ clientName: NO_CLIENT_LABEL })])).toMatchObject({ ok: false })
    expect(canInvoiceSelection([rec({ clientName: 'A' }), rec({ clientName: 'A' })])).toEqual({ ok: true, client: 'A' })
  })
})
