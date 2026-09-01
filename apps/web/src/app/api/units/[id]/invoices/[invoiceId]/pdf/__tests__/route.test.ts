import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Botão "Baixar PDF" (pedido do Vinicius, 2026-08-31) — diferente de POST
// .../send (que gera o mesmo PDF só como anexo de e-mail/mensagem e muda
// status), esta rota GET só devolve os bytes, sem efeito colateral nenhum,
// disponível pra qualquer status de fatura.

const generateInvoicePdf = vi.fn(async () => Buffer.from('%PDF-fake'))

function makeUnitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Unidade Central',
    timezone: 'America/Sao_Paulo',
    default_conversation_language: 'pt',
    logo_url: null,
    billing_company_name: null,
    billing_address: null,
    billing_email: null,
    billing_phone: null,
    billing_payment_instructions: null,
    ...overrides,
  }
}

function makeInvoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    customer_id: 'customer-1',
    invoice_number: 'INV-0001',
    description: 'Serviço de limpeza',
    amount: 150,
    currency: 'BRL',
    due_date: null,
    created_at: new Date().toISOString(),
    status: 'draft',
    notes: null,
    consolidated_items: null,
    ...overrides,
  }
}

function makeCustomerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'customer-1',
    unit_id: 'unit-1',
    org_id: 'org-1',
    name: 'Maria Silva',
    email: 'maria@example.com',
    phone: '+5511900000000',
    address: null,
    ...overrides,
  }
}

async function loadRoute(supabase: unknown) {
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
  vi.doMock('@/lib/invoices/pdf', () => ({ generateInvoicePdf }))
  return import('../route')
}

describe('GET /api/units/[id]/invoices/[invoiceId]/pdf', () => {
  beforeEach(() => {
    vi.resetModules()
    generateInvoicePdf.mockClear()
  })

  it('401 sem sessão autenticada', async () => {
    const { supabase } = createFakeSupabase({ units: [makeUnitRow()], invoices: [makeInvoiceRow()], customers: [makeCustomerRow()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: null } }) } })
    const { GET } = await loadRoute(supabase)

    const res = await GET(new Request('http://localhost/api/units/unit-1/invoices/invoice-1/pdf'), {
      params: Promise.resolve({ id: 'unit-1', invoiceId: 'invoice-1' }),
    })
    expect(res.status).toBe(401)
  })

  it('404 quando a fatura não existe (ou não pertence à unidade)', async () => {
    const { supabase } = createFakeSupabase({ units: [makeUnitRow()], invoices: [], customers: [makeCustomerRow()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { GET } = await loadRoute(supabase)

    const res = await GET(new Request('http://localhost/api/units/unit-1/invoices/nao-existe/pdf'), {
      params: Promise.resolve({ id: 'unit-1', invoiceId: 'nao-existe' }),
    })
    expect(res.status).toBe(404)
  })

  it('devolve o PDF pra baixar, com Content-Type e Content-Disposition corretos, mesmo pra fatura cancelada', async () => {
    const { supabase } = createFakeSupabase({
      units: [makeUnitRow()],
      invoices: [makeInvoiceRow({ status: 'cancelled', invoice_number: 'INV-0042' })],
      customers: [makeCustomerRow()],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { GET } = await loadRoute(supabase)

    const res = await GET(new Request('http://localhost/api/units/unit-1/invoices/invoice-1/pdf'), {
      params: Promise.resolve({ id: 'unit-1', invoiceId: 'invoice-1' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="fatura-INV-0042.pdf"')
    expect(generateInvoicePdf).toHaveBeenCalledTimes(1)

    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(Buffer.from(bytes).toString()).toBe('%PDF-fake')
  })

  it('regressão (2026-08-31): nunca deixa o navegador cachear o PDF — sem isso, editar a fatura e baixar de novo devolvia a versão antiga', async () => {
    const { supabase } = createFakeSupabase({ units: [makeUnitRow()], invoices: [makeInvoiceRow()], customers: [makeCustomerRow()] })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { GET } = await loadRoute(supabase)

    const res = await GET(new Request('http://localhost/api/units/unit-1/invoices/invoice-1/pdf'), {
      params: Promise.resolve({ id: 'unit-1', invoiceId: 'invoice-1' }),
    })
    expect(res.headers.get('Cache-Control')).toBe('no-store, must-revalidate')
  })

  it('regressão (2026-09-01): usa a descrição ATUAL do service_record em faturas consolidadas, não o snapshot antigo — achado real: editar a descrição de um serviço avulso depois de já faturado não aparecia no PDF', async () => {
    const { supabase } = createFakeSupabase({
      units: [makeUnitRow()],
      invoices: [
        makeInvoiceRow({
          consolidated_items: [{ invoice_id: 'record-1', invoice_number: '25/08/2026', description: '157662', amount: 631.38, due_date: null }],
        }),
      ],
      customers: [makeCustomerRow()],
      service_records: [{ id: 'record-1', invoice_id: 'invoice-1', description: '157662 - Compra de Material' }],
    })
    Object.assign(supabase, { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } })
    const { GET } = await loadRoute(supabase)

    await GET(new Request('http://localhost/api/units/unit-1/invoices/invoice-1/pdf'), {
      params: Promise.resolve({ id: 'unit-1', invoiceId: 'invoice-1' }),
    })

    const passedInvoice = (generateInvoicePdf.mock.calls[0] as unknown as [{ invoice: { consolidated_items: { description: string }[] } }])[0].invoice
    expect(passedInvoice.consolidated_items[0]!.description).toBe('157662 - Compra de Material')
  })
})
