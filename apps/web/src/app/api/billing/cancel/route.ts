import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { getPaymentProviderById } from '@/lib/payments/gateway-status'
import { logSystemEvent } from '@/lib/system-events'

export const dynamic = 'force-dynamic'

const GUARANTEE_WINDOW_DAYS = 7

/**
 * Cancelamento de assinatura self-service (pedido do Vinicius, 2026-08-25):
 * o cliente cancela a própria assinatura em Configurações, com motivo
 * obrigatório (feedback de churn). NÃO desativa a organização — is_active
 * continua true, isso é uma ação separada do Super Admin
 * (app/api/admin/orgs/[id]) — só billing_status vira 'canceled', o que já
 * basta pra bloquear o uso automaticamente (ver lib/payments/billing-gate.ts,
 * checado em todo webhook do WhatsApp antes de qualquer funcionário processar).
 *
 * Garantia de 7 dias (achado real, 2026-08-25): o checkout promete "7 dias
 * de garantia total", mas cancelar a assinatura recorrente NÃO desfaz uma
 * cobrança que já aconteceu — sem isso, cancelar no dia 3 ainda deixaria o
 * cliente cobrado, quebrando a promessa. Então, se o pagamento mais
 * recente foi confirmado há ≤7 dias, estorna ele de verdade via API
 * (refundPayment) antes de cancelar a recorrência — sem exigir que
 * ninguém entre no painel da processadora manualmente. Fora da janela,
 * só cancela a cobrança futura (comportamento normal de cancelamento).
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

  const provider = org.billing_provider ? await getPaymentProviderById(service, org.billing_provider) : null

  // Garantia de 7 dias: acha o pagamento confirmado mais recente e, se
  // estiver dentro do prazo, estorna de verdade antes de cancelar.
  let refunded = false
  const { data: lastPaid } = await service
    .from('financial_records')
    .select('id, paid_at, provider_payment_ref, amount')
    .eq('org_id', appUser.orgId)
    .eq('category', 'client_payment')
    .eq('status', 'paid')
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastPaid?.paid_at) {
    const daysSincePaid = (Date.now() - new Date(lastPaid.paid_at).getTime()) / (24 * 60 * 60 * 1000)
    if (daysSincePaid <= GUARANTEE_WINDOW_DAYS) {
      if (provider && lastPaid.provider_payment_ref) {
        const refundResult = await provider.refundPayment(lastPaid.provider_payment_ref)
        if (refundResult.ok) {
          refunded = true
          await service.from('financial_records').update({ status: 'cancelled' }).eq('id', lastPaid.id)
        } else {
          // Não bloqueia o cancelamento por causa disso — mas precisa
          // ficar visível pra alguém resolver manualmente (o cliente está
          // dentro da garantia, o dinheiro precisa voltar de um jeito ou
          // de outro).
          await logSystemEvent(service, {
            level: 'error',
            source: 'checkout',
            eventType: 'billing_refund_failed',
            message: `Cancelamento dentro da garantia de 7 dias, mas o estorno automático falhou (${org.billing_provider}): ${refundResult.error}. Estornar manualmente.`,
            orgId: appUser.orgId,
            metadata: { financialRecordId: lastPaid.id, providerPaymentRef: lastPaid.provider_payment_ref },
          })
        }
      } else {
        // Dentro da garantia, mas sem provider_payment_ref pra estornar
        // automaticamente (ex.: 1º pagamento via Stripe, que não expõe o
        // charge id no checkout.session.completed — ver stripe-provider.ts).
        await logSystemEvent(service, {
          level: 'warning',
          source: 'checkout',
          eventType: 'billing_refund_missing_ref',
          message: `Cancelamento dentro da garantia de 7 dias, mas não há provider_payment_ref pra estornar automaticamente (${org.billing_provider ?? 'sem provider'}). Estornar manualmente.`,
          orgId: appUser.orgId,
          metadata: { financialRecordId: lastPaid.id },
        })
      }
    }
  }

  // Só tenta cancelar na processadora quando há de fato uma assinatura
  // recorrente lá (org em trial, por exemplo, nunca teve uma). Sem
  // provider/credenciais configurados (falha nossa, não do cliente),
  // segue e cancela do nosso lado mesmo assim — nunca deixar o cliente
  // preso sem conseguir cancelar por causa de uma configuração nossa.
  if (provider && org.billing_provider_subscription_ref) {
    const result = await provider.cancelSubscription(org.billing_provider_subscription_ref)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Não foi possível cancelar a cobrança na processadora agora: ${result.error}. Fale com o suporte.` },
        { status: 502 },
      )
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

  return NextResponse.json({ ok: true, refunded })
}
