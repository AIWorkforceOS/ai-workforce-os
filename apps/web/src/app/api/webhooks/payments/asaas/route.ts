import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createAsaasProvider } from '@/lib/payments/asaas-provider'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'

export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/payments/asaas
 *
 * Configurar em: Asaas → Configurações → Integrações → Webhooks.
 * URL deste endpoint + "Token de autenticação" = env ASAAS_WEBHOOK_TOKEN
 * (Asaas assina via token fixo no header `asaas-access-token`, não HMAC).
 */
export async function POST(request: Request) {
  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const rawBody = await request.text()
  // Verificação de assinatura e parsing de evento não dependem da API
  // key de cobrança (só ASAAS_WEBHOOK_TOKEN) — instanciamos o provider
  // sem chave real porque createCustomerAndCharge nunca é chamado aqui.
  const provider = createAsaasProvider('')

  const result = await handlePaymentWebhook({ supabase, provider, rawBody, headers: request.headers })
  return NextResponse.json(result.body, { status: result.status })
}
