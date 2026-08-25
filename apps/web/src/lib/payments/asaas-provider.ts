import type { ChargeInput, ChargeResult, PaymentProvider, PaymentWebhookEvent, PaymentWebhookEventType } from './provider'

/**
 * Asaas (BR) — cartão de crédito/débito recorrente, via Checkout
 * hospedado da Asaas (POST /v3/checkouts, chargeTypes=RECURRENT). Nunca
 * PIX/boleto: decisão do produto (2026-08-25) é aceitar só cartão, porque
 * é o único método que permite cobrança automática de verdade todo mês
 * sem o cliente precisar agir — PIX/boleto recorrente na Asaas ainda
 * exige o cliente pagar cada fatura manualmente. Usar o Checkout
 * hospedado (não POST /subscriptions com billingType=CREDIT_CARD direto)
 * é essencial: a alternativa exigiria receber os dados do cartão no
 * nosso servidor pra repassar à Asaas — o Checkout evita isso por
 * completo, o cliente digita o cartão só na página da própria Asaas.
 *
 * Docs: https://docs.asaas.com
 */

function asaasBaseUrl(): string {
  return process.env.ASAAS_ENV === 'sandbox' ? 'https://sandbox.asaas.com/api/v3' : 'https://api.asaas.com/v3'
}

const EVENT_MAP: Record<string, PaymentWebhookEventType> = {
  PAYMENT_CONFIRMED: 'payment_success',
  PAYMENT_RECEIVED: 'payment_success',
  PAYMENT_OVERDUE: 'past_due',
  PAYMENT_DELETED: 'canceled',
  PAYMENT_REFUNDED: 'refunded',
  PAYMENT_REFUND_IN_PROGRESS: 'refunded',
  PAYMENT_CHARGEBACK_REQUESTED: 'past_due',
}

export function createAsaasProvider(apiKey: string): PaymentProvider {
  async function asaasFetch(path: string, body: Record<string, unknown>, method: 'POST' | 'DELETE' = 'POST') {
    const res = await fetch(`${asaasBaseUrl()}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', access_token: apiKey },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    })
    const data = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, data: data as Record<string, unknown> | null }
  }

  return {
    id: 'asaas',

    async createCustomerAndCharge(input: ChargeInput): Promise<ChargeResult> {
      // Cliente criado via API primeiro (mesmo padrão do Stripe,
      // stripe-provider.ts) pra providerCustomerRef ficar disponível já
      // na resposta — resolve o webhook (payment.customer) em qualquer
      // cobrança futura da assinatura, sem depender de externalReference.
      const customerRes = await asaasFetch('/customers', {
        name: input.name,
        email: input.email,
        mobilePhone: input.phone ?? undefined,
      })
      const customerId = customerRes.data?.id as string | undefined
      if (!customerRes.ok || !customerId) {
        const errors = customerRes.data?.errors as Array<{ description?: string }> | undefined
        return { ok: false, error: `Asaas (cliente): ${errors?.[0]?.description ?? `HTTP ${customerRes.status}`}` }
      }

      const nextDueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const checkoutRes = await asaasFetch('/checkouts', {
        customer: customerId,
        billingTypes: ['CREDIT_CARD'],
        chargeTypes: ['RECURRENT'],
        minutesToExpire: 60,
        callback: {
          successUrl: input.successUrl ?? 'https://www.alizoai.com/dashboard?billing=success',
          cancelUrl: input.cancelUrl ?? 'https://www.alizoai.com/checkout?billing=canceled',
        },
        items: [{ name: input.description, quantity: 1, value: input.amount }],
        subscription: { cycle: 'MONTHLY', nextDueDate },
      })
      const checkoutId = checkoutRes.data?.id as string | undefined
      const checkoutLink = checkoutRes.data?.link as string | undefined
      if (!checkoutRes.ok || !checkoutId) {
        const errors = checkoutRes.data?.errors as Array<{ description?: string }> | undefined
        return { ok: false, error: `Asaas (checkout): ${errors?.[0]?.description ?? `HTTP ${checkoutRes.status}`}` }
      }

      return {
        ok: true,
        providerCustomerRef: customerId,
        // Referência provisória (id do Checkout, não da assinatura — a
        // assinatura só existe depois que o cliente completa o
        // pagamento). webhook-handler.ts resolve a organização pelo
        // providerCustomerRef acima; quando o 1º pagamento confirmar
        // (PAYMENT_CONFIRMED), guardamos o subscription real por cima
        // (ver checkout/complete e webhook-handler).
        providerChargeRef: checkoutId,
        paymentUrl: checkoutLink ?? null,
        status: 'pending',
      }
    },

    async cancelSubscription(subscriptionRef: string): Promise<{ ok: boolean; error?: string }> {
      const res = await asaasFetch(`/subscriptions/${subscriptionRef}`, {}, 'DELETE')
      if (!res.ok) {
        const errors = res.data?.errors as Array<{ description?: string }> | undefined
        return { ok: false, error: `Asaas (cancelar assinatura): ${errors?.[0]?.description ?? `HTTP ${res.status}`}` }
      }
      return { ok: true }
    },

    verifyWebhookSignature(_rawBody: string, headers: Headers): boolean {
      // Asaas assina via token fixo enviado no header configurado no
      // dashboard (Configurações → Webhooks → "Token de autenticação"),
      // não HMAC — comparação direta é o modelo deles.
      const expected = process.env.ASAAS_WEBHOOK_TOKEN
      if (!expected) return false
      const received = headers.get('asaas-access-token')
      return !!received && received === expected
    },

    parseWebhookEvent(rawBody: string): PaymentWebhookEvent | null {
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(rawBody)
      } catch {
        return null
      }
      const eventName = payload.event as string | undefined
      const type = eventName ? EVENT_MAP[eventName] : undefined
      const payment = payload.payment as Record<string, unknown> | undefined
      if (!type || !payment?.id) return null

      // payment.subscription: id real da assinatura que gerou esta cobrança
      // (presente em pagamentos recorrentes) — diferente do id do Checkout
      // guardado como providerChargeRef na criação (ver createCustomerAndCharge
      // acima). ATENÇÃO: verificar contra um payload real em sandbox antes
      // de confiar em produção — a doc pública da Asaas não confirma 100%
      // este campo no payload de webhook (só no objeto de listagem).
      const subscriptionRef = typeof payment.subscription === 'string' ? payment.subscription : null

      return {
        externalEventId: `${eventName}:${payment.id}`,
        type,
        providerChargeRef: String(payment.id),
        providerCustomerRef: payment.customer ? String(payment.customer) : null,
        ...(subscriptionRef ? { providerSubscriptionRef: subscriptionRef } : {}),
        raw: payload,
      }
    },
  }
}
