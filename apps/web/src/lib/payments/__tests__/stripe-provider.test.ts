import { createHmac } from 'node:crypto'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { createStripeProvider } from '../stripe-provider'

function signedHeader(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${rawBody}`
  const signature = createHmac('sha256', secret).update(signedPayload).digest('hex')
  return `t=${timestamp},v1=${signature}`
}

describe('StripeProvider — verifyWebhookSignature', () => {
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET

  afterEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = originalSecret
  })

  it('rejeita sem STRIPE_WEBHOOK_SECRET configurada', () => {
    delete process.env.STRIPE_WEBHOOK_SECRET
    const provider = createStripeProvider('')
    const headers = new Headers({ 'stripe-signature': 't=1,v1=abc' })
    expect(provider.verifyWebhookSignature('{}', headers)).toBe(false)
  })

  it('rejeita sem header stripe-signature', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    const provider = createStripeProvider('')
    expect(provider.verifyWebhookSignature('{}', new Headers())).toBe(false)
  })

  it('rejeita assinatura com HMAC incorreto', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    const provider = createStripeProvider('')
    const headers = new Headers({ 'stripe-signature': 't=123,v1=assinatura-forjada' })
    expect(provider.verifyWebhookSignature('{"a":1}', headers)).toBe(false)
  })

  it('aceita assinatura HMAC válida (mesmo algoritmo do Stripe: HMAC-SHA256 de "{t}.{body}")', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    const provider = createStripeProvider('')
    const rawBody = '{"id":"evt_1","type":"checkout.session.completed"}'
    const header = signedHeader(rawBody, 'whsec_test')
    expect(provider.verifyWebhookSignature(rawBody, new Headers({ 'stripe-signature': header }))).toBe(true)
  })
})

describe('StripeProvider — parseWebhookEvent', () => {
  const provider = createStripeProvider('')

  it('mapeia checkout.session.completed para payment_success', () => {
    const payload = JSON.stringify({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', customer: 'cus_1' } },
    })
    const event = provider.parseWebhookEvent(payload)
    expect(event).toMatchObject({ type: 'payment_success', providerChargeRef: 'cs_1', providerCustomerRef: 'cus_1' })
    expect(event?.externalEventId).toBe('evt_1')
  })

  it('regressão (2026-08-25): invoice.payment_failed vai direto pra past_due — antes não estava mapeado, org paga via Stripe nunca bloqueava (só a Asaas chegava a past_due)', () => {
    expect(
      provider.parseWebhookEvent(
        JSON.stringify({ id: 'evt_2', type: 'invoice.payment_failed', data: { object: { id: 'in_1' } } }),
      )?.type,
    ).toBe('past_due')
    expect(
      provider.parseWebhookEvent(
        JSON.stringify({ id: 'evt_3', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } }),
      )?.type,
    ).toBe('subscription_canceled')
  })

  it('retorna null pra tipo de evento não mapeado', () => {
    expect(
      provider.parseWebhookEvent(JSON.stringify({ id: 'evt_4', type: 'customer.created', data: { object: {} } })),
    ).toBeNull()
  })

  it('retorna null pra JSON inválido', () => {
    expect(provider.parseWebhookEvent('not json')).toBeNull()
  })

  it('regressão (2026-08-25): checkout.session.completed extrai o id REAL da assinatura (obj.subscription), não o id da sessão — sem isso cancelSubscription cancelaria o id errado', () => {
    const event = provider.parseWebhookEvent(
      JSON.stringify({
        id: 'evt_5',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_1', customer: 'cus_1', subscription: 'sub_real_123' } },
      }),
    )
    expect(event?.providerChargeRef).toBe('cs_1')
    expect(event?.providerSubscriptionRef).toBe('sub_real_123')
  })

  it('sem obj.subscription no payload, providerSubscriptionRef fica ausente (não quebra)', () => {
    const event = provider.parseWebhookEvent(
      JSON.stringify({ id: 'evt_6', type: 'checkout.session.completed', data: { object: { id: 'cs_2', customer: 'cus_1' } } }),
    )
    expect(event?.providerSubscriptionRef).toBeUndefined()
  })

  it('regressão (2026-08-25, garantia de 7 dias): extrai obj.charge como providerPaymentRef em evento de invoice (cobrança recorrente)', () => {
    const event = provider.parseWebhookEvent(
      JSON.stringify({
        id: 'evt_7',
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_1', customer: 'cus_1', charge: 'ch_real_9' } },
      }),
    )
    expect(event?.providerPaymentRef).toBe('ch_real_9')
  })

  it('sem obj.charge no payload (ex.: checkout.session.completed do 1º pagamento), providerPaymentRef fica ausente — estorno automático não é possível nesse caso, ver comentário em stripe-provider.ts', () => {
    const event = provider.parseWebhookEvent(
      JSON.stringify({ id: 'evt_8', type: 'checkout.session.completed', data: { object: { id: 'cs_3', customer: 'cus_1' } } }),
    )
    expect(event?.providerPaymentRef).toBeUndefined()
  })
})

describe('StripeProvider — createCustomerAndCharge', () => {
  const originalPrice = process.env.STRIPE_PRICE_STARTER

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.STRIPE_PRICE_STARTER = originalPrice
  })

  it('retorna erro claro quando o price ID do plano não está configurado', async () => {
    delete process.env.STRIPE_PRICE_STARTER
    const provider = createStripeProvider('sk_test')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'cus_1' }), { status: 200 })),
    )

    const result = await provider.createCustomerAndCharge({
      name: 'John',
      email: 'john@bakery.com',
      phone: null,
      plan: 'starter',
      amount: 97,
      currency: 'USD',
      paymentMethod: 'card',
      description: 'teste',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('price ID')
  })

  it('retorna a URL da Checkout Session quando tudo dá certo', async () => {
    process.env.STRIPE_PRICE_STARTER = 'price_123'
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/customers')) return new Response(JSON.stringify({ id: 'cus_1' }), { status: 200 })
      if (String(url).includes('/checkout/sessions')) {
        return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createStripeProvider('sk_test')
    const result = await provider.createCustomerAndCharge({
      name: 'John',
      email: 'john@bakery.com',
      phone: null,
      plan: 'starter',
      amount: 97,
      currency: 'USD',
      paymentMethod: 'card',
      description: 'teste',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.paymentUrl).toBe('https://checkout.stripe.com/cs_1')
      expect(result.providerChargeRef).toBe('cs_1')
    }
  })
})

describe('StripeProvider — cancelSubscription', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('chama DELETE /subscriptions/{id} e retorna ok quando a Stripe confirma o cancelamento', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain('/subscriptions/sub_real_123')
      expect(init?.method).toBe('DELETE')
      return new Response(JSON.stringify({ id: 'sub_real_123', status: 'canceled' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createStripeProvider('sk_test')
    const result = await provider.cancelSubscription('sub_real_123')
    expect(result.ok).toBe(true)
  })

  it('retorna erro descritivo quando a Stripe rejeita o cancelamento', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'No such subscription' } }), { status: 404 })),
    )
    const provider = createStripeProvider('sk_test')
    const result = await provider.cancelSubscription('sub_inexistente')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('No such subscription')
  })
})

describe('StripeProvider — refundPayment (garantia de 7 dias)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('chama POST /refunds com o charge id e retorna ok', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain('/refunds')
      expect(init?.method ?? 'POST').toBe('POST')
      expect(String(init?.body)).toContain('charge=ch_real_9')
      return new Response(JSON.stringify({ id: 're_1', status: 'succeeded' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createStripeProvider('sk_test')
    const result = await provider.refundPayment('ch_real_9')
    expect(result.ok).toBe(true)
  })

  it('retorna erro descritivo quando a Stripe rejeita o estorno', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Charge already refunded' } }), { status: 400 })),
    )
    const provider = createStripeProvider('sk_test')
    const result = await provider.refundPayment('ch_real_9')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Charge already refunded')
  })
})
