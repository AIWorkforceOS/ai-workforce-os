import { describe, expect, it, vi, afterEach } from 'vitest'
import { createAsaasProvider } from '../asaas-provider'

describe('AsaasProvider — verifyWebhookSignature', () => {
  const originalToken = process.env.ASAAS_WEBHOOK_TOKEN

  afterEach(() => {
    process.env.ASAAS_WEBHOOK_TOKEN = originalToken
  })

  it('rejeita quando ASAAS_WEBHOOK_TOKEN não está configurada, mesmo com header presente', () => {
    delete process.env.ASAAS_WEBHOOK_TOKEN
    const provider = createAsaasProvider('')
    const headers = new Headers({ 'asaas-access-token': 'qualquer-coisa' })
    expect(provider.verifyWebhookSignature('{}', headers)).toBe(false)
  })

  it('rejeita quando o token do header não bate com o configurado', () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'token-certo'
    const provider = createAsaasProvider('')
    const headers = new Headers({ 'asaas-access-token': 'token-errado' })
    expect(provider.verifyWebhookSignature('{}', headers)).toBe(false)
  })

  it('aceita quando o token do header bate exatamente', () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'token-certo'
    const provider = createAsaasProvider('')
    const headers = new Headers({ 'asaas-access-token': 'token-certo' })
    expect(provider.verifyWebhookSignature('{}', headers)).toBe(true)
  })
})

describe('AsaasProvider — parseWebhookEvent', () => {
  const provider = createAsaasProvider('')

  it('mapeia PAYMENT_CONFIRMED para payment_success', () => {
    const body = JSON.stringify({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1', customer: 'cus_1' } })
    const event = provider.parseWebhookEvent(body)
    expect(event).toMatchObject({ type: 'payment_success', providerChargeRef: 'pay_1', providerCustomerRef: 'cus_1' })
    expect(event?.externalEventId).toBe('PAYMENT_CONFIRMED:pay_1')
  })

  it('a cada cobrança mensal gerada pela assinatura, o pagamento continua trazendo o customer ref — é isso que resolve a org de volta no webhook-handler (a subscription ref só serve de fallback)', () => {
    const body = JSON.stringify({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_month_2', customer: 'cus_1' } })
    const event = provider.parseWebhookEvent(body)
    expect(event?.providerCustomerRef).toBe('cus_1')
  })

  it('mapeia PAYMENT_OVERDUE para past_due e PAYMENT_REFUNDED para refunded', () => {
    expect(
      provider.parseWebhookEvent(JSON.stringify({ event: 'PAYMENT_OVERDUE', payment: { id: 'pay_2' } }))?.type,
    ).toBe('past_due')
    expect(
      provider.parseWebhookEvent(JSON.stringify({ event: 'PAYMENT_REFUNDED', payment: { id: 'pay_3' } }))?.type,
    ).toBe('refunded')
  })

  it('retorna null pra evento não mapeado', () => {
    expect(provider.parseWebhookEvent(JSON.stringify({ event: 'CUSTOMER_UPDATED', payment: { id: 'x' } }))).toBeNull()
  })

  it('retorna null pra payload sem payment.id', () => {
    expect(provider.parseWebhookEvent(JSON.stringify({ event: 'PAYMENT_CONFIRMED' }))).toBeNull()
  })

  it('retorna null pra JSON inválido', () => {
    expect(provider.parseWebhookEvent('{ not valid json')).toBeNull()
  })
})

describe('AsaasProvider — createCustomerAndCharge', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('cria a assinatura mensal e busca o paymentUrl da 1ª cobrança gerada por ela', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/customers')) return new Response(JSON.stringify({ id: 'cus_9' }), { status: 200 })
      if (!init || init.method === 'POST') {
        if (u.includes('/subscriptions')) return new Response(JSON.stringify({ id: 'sub_9' }), { status: 200 })
      }
      if (u.includes('/payments?subscription=sub_9')) {
        return new Response(JSON.stringify({ data: [{ id: 'pay_9', invoiceUrl: 'https://asaas.com/i/pay_9' }] }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createAsaasProvider('fake-key')
    const result = await provider.createCustomerAndCharge({
      name: 'Maria',
      email: 'maria@padaria.com',
      phone: null,
      plan: 'starter',
      amount: 497,
      currency: 'BRL',
      paymentMethod: 'pix',
      description: 'teste',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.paymentUrl).toBe('https://asaas.com/i/pay_9')
      expect(result.providerCustomerRef).toBe('cus_9')
      expect(result.providerChargeRef).toBe('sub_9')
    }
  })

  it('retorna erro descritivo quando a API do Asaas rejeita o cliente', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ errors: [{ description: 'CPF/CNPJ inválido' }] }), { status: 400 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const provider = createAsaasProvider('fake-key')
    const result = await provider.createCustomerAndCharge({
      name: 'Maria',
      email: 'maria@padaria.com',
      phone: null,
      plan: 'starter',
      amount: 497,
      currency: 'BRL',
      paymentMethod: 'pix',
      description: 'teste',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('CPF/CNPJ inválido')
  })

  it('retorna erro descritivo quando a API do Asaas rejeita a criação da assinatura', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/customers')) return new Response(JSON.stringify({ id: 'cus_9' }), { status: 200 })
      return new Response(JSON.stringify({ errors: [{ description: 'ciclo inválido' }] }), { status: 400 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createAsaasProvider('fake-key')
    const result = await provider.createCustomerAndCharge({
      name: 'Maria',
      email: 'maria@padaria.com',
      phone: null,
      plan: 'starter',
      amount: 497,
      currency: 'BRL',
      paymentMethod: 'pix',
      description: 'teste',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('ciclo inválido')
  })

  it('ainda retorna ok=true com paymentUrl null se a assinatura foi criada mas a busca da 1ª cobrança falhar (best-effort)', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/customers')) return new Response(JSON.stringify({ id: 'cus_9' }), { status: 200 })
      if (!init || init.method === 'POST') {
        if (u.includes('/subscriptions')) return new Response(JSON.stringify({ id: 'sub_9' }), { status: 200 })
      }
      return new Response('{}', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createAsaasProvider('fake-key')
    const result = await provider.createCustomerAndCharge({
      name: 'Maria',
      email: 'maria@padaria.com',
      phone: null,
      plan: 'starter',
      amount: 497,
      currency: 'BRL',
      paymentMethod: 'pix',
      description: 'teste',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.paymentUrl).toBeNull()
      expect(result.providerChargeRef).toBe('sub_9')
    }
  })
})
