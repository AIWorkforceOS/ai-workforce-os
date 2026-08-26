import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/checkout/status?pending=<id> — a tela de retorno do checkout
 * hospedado (app/checkout/finish, chamada depois do redirect da
 * Asaas/Stripe) faz polling aqui até o webhook confirmar o pagamento e
 * provisionar a conta (ver lib/payments/webhook-handler.ts). Não expõe
 * nada além do status — sem dados pessoais na resposta.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('pending')
  if (!id) {
    return NextResponse.json({ status: 'not_found' }, { status: 400 })
  }

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json({ status: 'not_found' }, { status: 503 })
  }

  const { data } = await service.from('pending_signups').select('status').eq('id', id).maybeSingle()
  if (!data) {
    return NextResponse.json({ status: 'not_found' })
  }

  return NextResponse.json({ status: data.status as 'pending' | 'completed' | 'expired' })
}
