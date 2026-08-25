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

  it('regressão (2026-08-25, garantia de 7 dias): extrai payment.id como providerPaymentRef — é o que refundPayment usa pra estornar a cobrança certa', () => {
    const body = JSON.stringify({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1', customer: 'cus_1' } })
    const event = provider.parseWebhookEvent(body)
    expect(event?.providerPaymentRef).toBe('pay_1')
  })

  it('a cada cobrança mensal gerada pela assinatura, o pagamento continua trazendo o customer ref — é isso que resolve a org de volta no webhook-handler (a subscription ref só serve de fallback)', () => {
    const body = JSON.stringify({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_month_2', customer: 'cus_1' } })
    const event = provider.parseWebhookEvent(body)
    expect(event?.providerCustomerRef).toBe('cus_1')
  })

  it('extrai payment.subscription como providerSubscriptionRef quando presente (corrige billing_provider_subscription_ref pro id real da assinatura)', () => {
    const body = JSON.stringify({
      event: 'PAYMENT_CONFIRMED',
      payment: { id: 'pay_1', customer: 'cus_1', subscription: 'sub_real_9' },
    })
    const event = provider.parseWebhookEvent(body)
    expect(event?.providerSubscriptionRef).toBe('sub_real_9')
  })

  it('sem payment.subscription no payload, providerSubscriptionRef fica ausente (não quebra)', () => {
    const body = JSON.stringify({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1', customer: 'cus_1' } })
    const event = provider.parseWebhookEvent(body)
    expect(event?.providerSubscriptionRef).toBeUndefined()
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

  it('cria o cliente e o Checkout hospedado (cartão recorrente), devolvendo o link e o id do checkout', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/customers')) return new Response(JSON.stringify({ id: 'cus_9' }), { status: 200 })
      if (u.includes('/checkouts')) {
        return new Response(
          JSON.stringify({ id: 'checkout_9', link: 'https://sandbox.asaas.com/checkoutSession/show/checkout_9' }),
          { status: 200 },
        )
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
      paymentMethod: 'card',
      description: 'teste',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.paymentUrl).toBe('https://sandbox.asaas.com/checkoutSession/show/checkout_9')
      expect(result.providerCustomerRef).toBe('cus_9')
      expect(result.providerChargeRef).toBe('checkout_9')
    }
  })

  it('o body do checkout pede só CREDIT_CARD (crédito/débito) e RECURRENT — nunca PIX/boleto, decisão do produto de 2026-08-25', async () => {
    let checkoutBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/customers')) return new Response(JSON.stringify({ id: 'cus_9' }), { status: 200 })
      if (u.includes('/checkouts')) {
        checkoutBody = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ id: 'checkout_9', link: 'https://x/checkout_9' }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createAsaasProvider('fake-key')
    await provider.createCustomerAndCharge({
      name: 'Maria',
      email: 'maria@padaria.com',
      phone: null,
      plan: 'starter',
      amount: 497,
      currency: 'BRL',
      paymentMethod: 'card',
      description: 'teste',
    })

    expect(checkoutBody).toMatchObject({
      customer: 'cus_9',
      billingTypes: ['CREDIT_CARD'],
      chargeTypes: ['RECURRENT'],
      subscription: { cycle: 'MONTHLY' },
    })
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
      paymentMethod: 'card',
      description: 'teste',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('CPF/CNPJ inválido')
  })

  it('retorna erro descritivo quando a API do Asaas rejeita a criação do checkout', async () => {
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
      paymentMethod: 'card',
      description: 'teste',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('ciclo inválido')
  })
})

describe('AsaasProvider — cancelSubscription', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('chama DELETE /subscriptions/{id} e retorna ok quando a Asaas confirma o cancelamento', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain('/subscriptions/sub_real_9')
      expect(init?.method).toBe('DELETE')
      return new Response(JSON.stringify({ id: 'sub_real_9', deleted: true }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createAsaasProvider('fake-key')
    const result = await provider.cancelSubscription('sub_real_9')
    expect(result.ok).toBe(true)
  })

  it('retorna erro descritivo quando a Asaas rejeita o cancelamento', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ errors: [{ description: 'assinatura não encontrada' }] }), { status: 404 })),
    )
    const provider = createAsaasProvider('fake-key')
    const result = await provider.cancelSubscription('sub_inexistente')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('assinatura não encontrada')
  })
})

describe('AsaasProvider — refundPayment (garantia de 7 dias)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('chama POST /payments/{id}/refund sem "value" (estorno cheio) e retorna ok', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain('/payments/pay_123/refund')
      expect(init?.method).toBe('POST')
      return new Response(JSON.stringify({ id: 'pay_123', status: 'REFUNDED' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createAsaasProvider('fake-key')
    const result = await provider.refundPayment('pay_123')
    expect(result.ok).toBe(true)
  })

  it('retorna erro descritivo quando a Asaas rejeita o estorno', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ errors: [{ description: 'cobrança já estornada' }] }), { status: 400 })),
    )
    const provider = createAsaasProvider('fake-key')
    const result = await provider.refundPayment('pay_123')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('cobrança já estornada')
  })
})
