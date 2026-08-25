import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { getPaymentProviderById } from '@/lib/payments/gateway-status'

export const dynamic = 'force-dynamic'

/**
 * Cancelamento de assinatura self-service (pedido do Vinicius, 2026-08-25):
 * o cliente cancela a própria assinatura em Configurações, com motivo
 * obrigatório (feedback de churn), e a cobrança recorrente para de
 * verdade na processadora (Asaas/Stripe). NÃO desativa a organização —
 * is_active continua true, isso é uma ação separada do Super Admin
 * (app/api/admin/orgs/[id]) — só billing_status vira 'canceled', o que já
 * basta pra bloquear o uso automaticamente (ver lib/payments/billing-gate.ts,
 * checado em todo webhook do WhatsApp antes de qualquer funcionário processar).
 *
 * Usa o service client pro update em organizations pelo mesmo motivo de
 * todo o resto do módulo de pagamentos: a policy organizations_write exige
 * is_super_admin(), o client de sessão de um admin comum não conseguiria gravar.
 */
export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser || !appUser.orgId) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const reason: string | undefined = typeof body?.reason === 'string' ? body.reason.trim() : undefined
  if (!reason) {
    return NextResponse.json({ error: 'Conte o motivo do cancelamento antes de confirmar.' }, { status: 400 })
  }

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json({ error: 'Serviço indisponível no momento. Tente novamente.' }, { status: 503 })
  }

  const { data: org } = await service
    .from('organizations')
    .select('billing_status, billing_provider, billing_provider_subscription_ref')
    .eq('id', appUser.orgId)
    .maybeSingle()

  if (!org) {
    return NextResponse.json({ error: 'Organização não encontrada.' }, { status: 404 })
  }

  if (org.billing_status === 'canceled') {
    return NextResponse.json({ ok: true, alreadyCanceled: true })
  }

  // Só tenta cancelar na processadora quando há de fato uma assinatura
  // recorrente lá (org em trial, por exemplo, nunca teve uma). Sem
  // provider/credenciais configurados (falha nossa, não do cliente),
  // segue e cancela do nosso lado mesmo assim — nunca deixar o cliente
  // preso sem conseguir cancelar por causa de uma configuração nossa.
  if (org.billing_provider && org.billing_provider_subscription_ref) {
    const provider = await getPaymentProviderById(service, org.billing_provider)
    if (provider) {
      const result = await provider.cancelSubscription(org.billing_provider_subscription_ref)
      if (!result.ok) {
        return NextResponse.json(
          { error: `Não foi possível cancelar a cobrança na processadora agora: ${result.error}. Fale com o suporte.` },
          { status: 502 },
        )
      }
    }
  }

  const { error: updateError } = await service
    .from('organizations')
    .update({
      billing_status: 'canceled',
      cancellation_reason: reason,
      cancelled_at: new Date().toISOString(),
    })
    .eq('id', appUser.orgId)

  if (updateError) {
    return NextResponse.json(
      { error: 'A cobrança recorrente foi cancelada, mas houve um erro ao salvar aqui. Fale com o suporte.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
