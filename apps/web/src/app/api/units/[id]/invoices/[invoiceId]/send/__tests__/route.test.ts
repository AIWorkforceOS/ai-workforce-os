import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Reproduz o bug relatado: cliente edita telefone/e-mail do cliente final
// e, em seguida, envia (ou reenvia) uma fatura pra ele — o envio precisa
// usar sempre o contato mais atual do banco, nunca um valor congelado de
// antes da edição. As duas rotas reais (PATCH /api/customers/[id] e POST
// .../invoices/[invoiceId]/send) são exercitadas em sequência, como o
// usuário realmente usa o produto.

const sendInvoiceEmail = vi.fn(async () => ({ ok: true }))
const generateInvoicePdf = vi.fn(async () => Buffer.from('pdf'))
const sendMessage = vi.fn(async () => undefined)
const getMessagingChannel = vi.fn(() => ({ type: 'whatsapp', sendMessage }))
const buildInvoiceMessageText = vi.fn(() => 'texto da fatura')

function makeUnitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Unidade Central',
    timezone: 'America/Sao_Paulo',
    default_conversation_language: 'pt',
    logo_url: null,
    email_accent_color: null,
    email_footer_note: null,
    email_reply_to: null,
    ...overrides,
  }
}

describe('POST /api/units/[id]/invoices/[invoiceId]/send — contato do cliente sempre atual', () => {
  beforeEach(() => {
    vi.resetModules()
    sendInvoiceEmail.mockClear()
    generateInvoicePdf.mockClear()
    sendMessage.mockClear()
    getMessagingChannel.mockClear()
    buildInvoiceMessageText.mockClear()
  })

  it('usa o telefone/e-mail novos do cliente depois de uma edição via PATCH /api/customers/[id]', async () => {
    const { supabase, db } = createFakeSupabase({
      units: [makeUnitRow()],
      customers: [
        {
          id: 'customer-1',
          unit_id: 'unit-1',
          org_id: 'org-1',
          name: 'Maria Silva',
          email: 'antigo@example.com',
          phone: '+5511900000000',
        },
      ],
      invoices: [
        {
          id: 'invoice-1',
          org_id: 'org-1',
          unit_id: 'unit-1',
          customer_id: 'customer-1',
          invoice_number: 'INV-0001',
          description: 'Serviço de limpeza',
          amount: 150,
          currency: 'BRL',
          due_date: null,
          status: 'draft',
          sent_to_email: null,
          sent_to_phone: null,
          sent_at: null,
          paid_at: null,
          notes: null,
          consolidated_into_id: null,
          consolidated_items: null,
        },
      ],
    })
    Object.assign(supabase, {
      auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) },
    })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
    vi.doMock('@/lib/app-user', () => ({
      getAppUser: async () => ({
        id: 'user-1',
        email: 'dono@unidade.com',
        name: 'Dono',
        role: 'admin',
        orgId: 'org-1',
        orgName: 'Org',
        isSuperAdmin: false,
        unitId: 'unit-1',
      }),
    }))
    vi.doMock('@/lib/email', () => ({ sendInvoiceEmail }))
    vi.doMock('@/lib/invoices/pdf', () => ({ generateInvoicePdf }))
    vi.doMock('@/lib/channels/messaging-channel', () => ({ getMessagingChannel, buildInvoiceMessageText }))

    // 1) edita telefone e e-mail do cliente, como na tela de Clientes.
    const { PATCH } = await import('../../../../../../customers/[id]/route')
    const patchResponse = await PATCH(
      new Request('http://localhost/api/customers/customer-1', {
        method: 'PATCH',
        body: JSON.stringify({ phone: '+5511988887777', email: 'novo@example.com' }),
      }),
      { params: Promise.resolve({ id: 'customer-1' }) },
    )
    expect(patchResponse.status).toBe(200)
    expect(db.customers?.[0]).toMatchObject({ phone: '+5511988887777', email: 'novo@example.com' })

    // 2) envia a fatura em seguida — precisa ir pro contato novo, não o antigo.
    const { POST } = await import('../route')
    const sendResponse = await POST(new Request('http://localhost/api/units/unit-1/invoices/invoice-1/send', { method: 'POST' }), {
      params: Promise.resolve({ id: 'unit-1', invoiceId: 'invoice-1' }),
    })
    const sendBody = await sendResponse.json()

    expect(sendResponse.status).toBe(200)
    expect(sendBody.ok).toBe(true)

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
    expect(sendInvoiceEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'novo@example.com' }))
    expect(sendInvoiceEmail).not.toHaveBeenCalledWith(expect.objectContaining({ to: 'antigo@example.com' }))

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith('+5511988887777', expect.any(String))
    expect(sendMessage).not.toHaveBeenCalledWith('+5511900000000', expect.any(String))

    expect(db.invoices?.[0]).toMatchObject({
      sent_to_email: 'novo@example.com',
      sent_to_phone: '+5511988887777',
      status: 'sent',
    })
  })
})
