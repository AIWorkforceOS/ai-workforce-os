import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ChargeInput, ChargeResult, PaymentProvider, PaymentWebhookEvent, PaymentWebhookEventType } from './provider'

/**
 * Stripe (US) — Checkout Session em modo assinatura (subscription). O
 * cliente é redirecionado pra uma página hospedada da Stripe pra
 * inserir o cartão — nunca coletamos nem tocamos dado de cartão no
 * nosso frontend/backend (fora do escopo de PCI compliance).
 *
 * Sem SDK oficial (evita nova dependência): chamadas via fetch direto
 * na API REST da Stripe (application/x-www-form-urlencoded, como a
 * própria API exige) e verificação de assinatura de webhook via
 * crypto nativo do Node (mesmo algoritmo do stripe-node: HMAC-SHA256
 * sobre "{timestamp}.{body}").
 *
 * Docs: https://stripe.com/docs/api
 */

const STRIPE_BASE = 'https://api.stripe.com/v1'

const EVENT_MAP: Record<string, PaymentWebhookEventType> = {
  'checkout.session.completed': 'payment_success',
  'invoice.payment_succeeded': 'payment_success',
  // Achado real (2026-08-25): 'invoice.payment_failed' antes não estava
  // mapeado — uma org pagando via Stripe nunca chegava a 'past_due' via
  // webhook (só o Asaas chegava, via PAYMENT_OVERDUE). Sem isso, o
  // bloqueio automático de uso (ver lib/payments/billing-gate.ts) nunca
  // dispararia pra clientes Stripe.
  'invoice.payment_failed': 'past_due',
  'customer.subscription.deleted': 'subscription_canceled',
  'customer.subscription.trial_will_end': 'grace_period',
  'charge.refunded': 'refunded',
}

function toFormBody(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) usp.append(key, value)
  }
  return usp.toString()
}

export function createStripeProvider(secretKey: string): PaymentProvider {
  async function stripeFetch(path: string, params: Record<string, string | undefined>, method: 'POST' | 'DELETE' = 'POST') {
    const res = await fetch(`${STRIPE_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      ...(method === 'POST' ? { body: toFormBody(params) } : {}),
    })
    const data = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, data: data as Record<string, unknown> | null }
  }

  return {
    id: 'stripe',

    async createCustomerAndCharge(input: ChargeInput): Promise<ChargeResult> {
      const customerRes = await stripeFetch('/customers', {
        email: input.email,
        name: input.name,
        phone: input.phone ?? undefined,
      })
      const customerId = customerRes.data?.id as string | undefined
      if (!customerRes.ok || !customerId) {
        const err = customerRes.data?.error as { message?: string } | undefined
        return { ok: false, error: `Stripe (cliente): ${err?.message ?? `HTTP ${customerRes.status}`}` }
      }

      const priceId = input.plan === 'pro' ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_STARTER
      if (!priceId) {
        return {
          ok: false,
          error: `Stripe: price ID não configurado para o plano ${input.plan} (env STRIPE_PRICE_${input.plan.toUpperCase()})`,
        }
      }

      const sessionRes = await stripeFetch('/checkout/sessions', {
        customer: customerId,
        mode: 'subscription',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        success_url: input.successUrl ?? 'https://app.alizoai.com/dashboard?billing=success',
        cancel_url: input.cancelUrl ?? 'https://app.alizoai.com/checkout?billing=canceled',
      })
      const sessionId = sessionRes.data?.id as string | undefined
      if (!sessionRes.ok || !sessionId) {
        const err = sessionRes.data?.error as { message?: string } | undefined
        return { ok: false, error: `Stripe (checkout session): ${err?.message ?? `HTTP ${sessionRes.status}`}` }
      }

      return {
        ok: true,
        providerCustomerRef: customerId,
        providerChargeRef: sessionId,
        paymentUrl: (sessionRes.data?.url as string | undefined) ?? null,
        status: 'pending',
      }
    },

    async cancelSubscription(subscriptionRef: string): Promise<{ ok: boolean; error?: string }> {
      const res = await stripeFetch(`/subscriptions/${subscriptionRef}`, {}, 'DELETE')
      if (!res.ok) {
        const err = res.data?.error as { message?: string } | undefined
        return { ok: false, error: `Stripe (cancelar assinatura): ${err?.message ?? `HTTP ${res.status}`}` }
      }
      return { ok: true }
    },

    async refundPayment(paymentRef: string): Promise<{ ok: boolean; error?: string }> {
      // Sem "amount": a Stripe estorna o valor cheio por padrão (garantia
      // de 7 dias é tudo ou nada, nunca parcial). paymentRef precisa ser
      // um charge id (ch_...) ou payment_intent id (pi_...) — a Stripe
      // aceita os dois em "charge"/"payment_intent" respectivamente; como
      // não sabemos qual foi capturado (ver parseWebhookEvent), tentamos
      // como charge primeiro.
      const res = await stripeFetch('/refunds', { charge: paymentRef })
      if (!res.ok) {
        const err = res.data?.error as { message?: string } | undefined
        return { ok: false, error: `Stripe (estornar cobrança): ${err?.message ?? `HTTP ${res.status}`}` }
      }
      return { ok: true }
    },

    verifyWebhookSignature(rawBody: string, headers: Headers): boolean {
      const sigHeader = headers.get('stripe-signature')
      const secret = process.env.STRIPE_WEBHOOK_SECRET
      if (!sigHeader || !secret) return false

      const parts = Object.fromEntries(
        sigHeader.split(',').map((p) => {
          const [k, v] = p.split('=')
          return [k, v]
        }),
      )
      const timestamp = parts.t
      const signature = parts.v1
      if (!timestamp || !signature) return false

      const signedPayload = `${timestamp}.${rawBody}`
      const expected = createHmac('sha256', secret).update(signedPayload).digest('hex')
      try {
        return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
      } catch {
        return false
      }
    },

    parseWebhookEvent(rawBody: string): PaymentWebhookEvent | null {
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(rawBody)
      } catch {
        return null
      }
      const eventType = payload.type as string | undefined
      const type = eventType ? EVENT_MAP[eventType] : undefined
      if (!type) return null

      const data = payload.data as { object?: Record<string, unknown> } | undefined
      const obj = data?.object
      const eventId = payload.id as string | undefined
      if (!eventId) return null

      // checkout.session.completed: obj.id é o id da SESSÃO (cs_...), não
      // da assinatura — a Stripe expõe o id real da assinatura recorrente
      // (sub_...) no campo obj.subscription desse mesmo evento. Sem isso,
      // billing_provider_subscription_ref fica com o id da sessão pra
      // sempre, e cancelSubscription (DELETE /subscriptions/{id}) falharia.
      const subscriptionRef =
        eventType === 'checkout.session.completed' && typeof obj?.subscription === 'string' ? obj.subscription : null

      // obj.charge: presente em eventos de invoice (cobranças recorrentes,
      // a partir do 2º mês) — é o id refundável via refundPayment acima.
      // ATENÇÃO: no checkout.session.completed do 1º pagamento a Stripe
      // NÃO expõe o charge id na própria sessão (só subscription/customer/
      // payment_intent) — a garantia de 7 dias sobre o 1º mês de um
      // cliente Stripe não consegue estornar automaticamente hoje por essa
      // lacuna; cai no fallback manual do fluxo de cancelamento (ver
      // app/api/billing/cancel). Verificar contra um evento real antes de
      // confiar 100% — não testado contra a API de verdade nesta sessão
      // (o teste ao vivo desta rodada é só Asaas/BR).
      const paymentRef = typeof obj?.charge === 'string' ? obj.charge : null

      return {
        externalEventId: eventId,
        type,
        providerChargeRef: (obj?.id as string | undefined) ?? null,
        providerCustomerRef: (obj?.customer as string | undefined) ?? null,
        ...(subscriptionRef ? { providerSubscriptionRef: subscriptionRef } : {}),
        ...(paymentRef ? { providerPaymentRef: paymentRef } : {}),
        raw: payload,
      }
    },
  }
}
