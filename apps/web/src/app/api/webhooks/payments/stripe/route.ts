import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createStripeProvider } from '@/lib/payments/stripe-provider'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'

export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/payments/stripe
 *
 * Configurar em: Stripe Dashboard → Developers → Webhooks → Add endpoint.
 * Eventos a assinar: checkout.session.completed, invoice.payment_succeeded,
 * invoice.payment_failed, customer.subscription.deleted,
 * customer.subscription.trial_will_end, charge.refunded.
 * Signing secret = env STRIPE_WEBHOOK_SECRET.
 */
export async function POST(request: Request) {
  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const rawBody = await request.text()
  // Verificação de assinatura (HMAC com STRIPE_WEBHOOK_SECRET) e parsing de
  // evento não dependem da secret key de cobrança — instanciamos o
  // provider sem chave real porque createCustomerAndCharge nunca é
  // chamado aqui.
  const provider = createStripeProvider('')

  const result = await handlePaymentWebhook({ supabase, provider, rawBody, headers: request.headers })
  return NextResponse.json(result.body, { status: result.status })
}
