/**
 * Abstração de processadora de pagamento — um PaymentProvider por
 * processadora real (Asaas no Brasil, Stripe nos EUA), implementando o
 * mesmo contrato. Nenhuma lógica de gateway específica deve vazar pra
 * fora de lib/payments/*: checkout, webhooks e telas admin só falam
 * com esta interface.
 *
 * Decisão de arquitetura: cobrança nunca bloqueia a criação de conta
 * (ver lib/payments/gateway-status.ts e app/api/checkout/complete/route.ts).
 * createCustomerAndCharge é chamado DEPOIS da conta já existir, best-effort —
 * se falhar ou não houver provider configurado, a conta continua ativa com
 * organizations.billing_status = 'trialing' e financial_records.status
 * continua 'pending' (schema existente, sem alteração).
 */

export type PaymentRegion = 'BR' | 'US'

export type PaymentMethodHint = 'pix' | 'boleto' | 'card' | 'zelle'

export type ChargeInput = {
  name: string
  email: string
  phone: string | null
  plan: 'starter' | 'pro'
  amount: number
  currency: 'BRL' | 'USD'
  paymentMethod: PaymentMethodHint
  description: string
  /** URL de retorno pro app depois do checkout hospedado (Stripe Checkout Session). */
  successUrl?: string
  cancelUrl?: string
}

export type ChargeResult =
  | {
      ok: true
      providerCustomerRef: string
      /** Referência da cobrança/sessão/assinatura no provider — o que os webhooks usam para achar a org de volta. */
      providerChargeRef: string
      /** Link de pagamento hospedado (invoice do Asaas, Checkout Session da Stripe) — null quando o provider não usa esse padrão. */
      paymentUrl: string | null
      status: 'pending' | 'paid'
    }
  | { ok: false; error: string }

export type PaymentWebhookEventType =
  | 'payment_success'
  | 'payment_failed'
  | 'past_due'
  | 'canceled'
  | 'refunded'
  | 'subscription_activated'
  | 'subscription_canceled'
  | 'grace_period'

export type PaymentWebhookEvent = {
  /** Único por provider — usado pra idempotência (webhook_events.external_event_id). */
  externalEventId: string
  type: PaymentWebhookEventType
  providerChargeRef: string | null
  providerCustomerRef: string | null
  /**
   * Id REAL da assinatura recorrente, quando o evento o revela e é
   * diferente de providerChargeRef (ex.: Stripe checkout.session.completed
   * — providerChargeRef ali é o id da SESSÃO, não da assinatura; a
   * assinatura só existe depois que a Stripe processa o checkout). Quando
   * presente, webhook-handler.ts atualiza
   * organizations.billing_provider_subscription_ref com este valor —
   * necessário pra cancelSubscription funcionar com o id certo depois.
   */
  providerSubscriptionRef?: string | null
  raw: unknown
}

export interface PaymentProvider {
  id: 'asaas' | 'stripe'
  createCustomerAndCharge(input: ChargeInput): Promise<ChargeResult>
  /** Cancela a cobrança recorrente na processadora (organizations.billing_provider_subscription_ref) — usado pelo fluxo de cancelamento do cliente (ver app/api/billing/cancel). Idempotente do lado de quem chama: se a assinatura já não existir/estiver cancelada na processadora, trate como sucesso. */
  cancelSubscription(subscriptionRef: string): Promise<{ ok: boolean; error?: string }>
  /** Valida a assinatura do webhook a partir do corpo bruto (string, antes de JSON.parse) e dos headers da requisição. */
  verifyWebhookSignature(rawBody: string, headers: Headers): boolean
  /** Interpreta o corpo já validado num evento normalizado; retorna null para tipos de evento que não mapeamos (ignorados). */
  parseWebhookEvent(rawBody: string): PaymentWebhookEvent | null
}
