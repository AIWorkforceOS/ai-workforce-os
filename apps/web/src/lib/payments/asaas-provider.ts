import type { ChargeInput, ChargeResult, PaymentProvider, PaymentWebhookEvent, PaymentWebhookEventType } from './provider'

/**
 * Asaas (BR) — PIX/boleto/cartão numa API só, com invoiceUrl hospedada
 * (o cliente paga num link do próprio Asaas; não guardamos dado de
 * cartão no nosso servidor nem no frontend).
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

const BILLING_TYPE: Record<ChargeInput['paymentMethod'], string> = {
  pix: 'PIX',
  boleto: 'BOLETO',
  card: 'CREDIT_CARD',
  zelle: 'PIX', // zelle não existe pro Asaas (BR-only) — fallback nunca deve ser exercitado na prática (região US usa Stripe)
}

export function createAsaasProvider(apiKey: string): PaymentProvider {
  async function asaasFetch(path: string, body: Record<string, unknown>) {
    const res = await fetch(`${asaasBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', access_token: apiKey },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, data: data as Record<string, unknown> | null }
  }

  return {
    id: 'asaas',

    async createCustomerAndCharge(input: ChargeInput): Promise<ChargeResult> {
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

      const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const chargeRes = await asaasFetch('/payments', {
        customer: customerId,
        billingType: BILLING_TYPE[input.paymentMethod],
        value: input.amount,
        dueDate,
        description: input.description,
      })
      const chargeId = chargeRes.data?.id as string | undefined
      if (!chargeRes.ok || !chargeId) {
        const errors = chargeRes.data?.errors as Array<{ description?: string }> | undefined
        return { ok: false, error: `Asaas (cobrança): ${errors?.[0]?.description ?? `HTTP ${chargeRes.status}`}` }
      }

      return {
        ok: true,
        providerCustomerRef: customerId,
        providerChargeRef: chargeId,
        paymentUrl: (chargeRes.data?.invoiceUrl as string | undefined) ?? null,
        status: 'pending',
      }
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

      return {
        externalEventId: `${eventName}:${payment.id}`,
        type,
        providerChargeRef: String(payment.id),
        providerCustomerRef: payment.customer ? String(payment.customer) : null,
        raw: payload,
      }
    },
  }
}
