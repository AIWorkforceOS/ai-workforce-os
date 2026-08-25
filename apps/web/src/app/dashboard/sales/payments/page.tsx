import { createClient } from '@/lib/supabase/server'
import { CreditCard, Landmark } from 'lucide-react'
import { Card, PageHeader } from '@/components/ui/dashboard-ui'
import { PaymentGatewayForm, type GatewayRow } from '@/components/admin/payment-gateway-form'

export const dynamic = 'force-dynamic'

/**
 * Painel interno (super admin, herda o guard do SalesLayout): credenciais
 * das processadoras de pagamento por região + guia de escolha. A
 * integração real já existe em código (lib/payments/*) — assim que uma
 * linha aqui é marcada "Ativo" com credenciais preenchidas, o checkout
 * passa a cobrar de verdade (Asaas: assinatura mensal recorrente; Stripe:
 * Checkout Session recorrente). Sem isso, a cobrança fica pendente e a
 * conta segue liberada mesmo assim (nunca bloqueia cadastro).
 */
export default async function PaymentsSetupPage() {
  const supabase = await createClient()

  // Tabela pode ainda não existir (migration 20260714000009 pendente)
  let rows: GatewayRow[] = []
  let tableMissing = false
  const { data, error } = await supabase.from('payment_gateway_settings').select('*').order('region')
  if (error) {
    tableMissing = true
  } else {
    rows = (data ?? []) as GatewayRow[]
  }

  const brRows = rows.filter((r) => r.region === 'BR')
  const usRows = rows.filter((r) => r.region === 'US')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="operação alizo"
        title="Processadoras de pagamento"
        subtitle="Escolha e configure as processadoras do Brasil e dos EUA. A integração já é real: assim que uma linha abaixo estiver com credenciais preenchidas e marcada como ativa, o checkout passa a cobrar de verdade."
      />

      {/* ─── GUIA DE ESCOLHA ─── */}
      <Card className="p-6">
        <h2 className="text-sm font-black text-white">Guia rápido: qual processadora escolher</h2>
        <p className="mt-1 text-xs text-slate-500">
          Pesquisa de julho/2026, priorizando custo baixo e API fácil. Taxas mudam por negociação e volume —
          confirme na contratação.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Brasil */}
          <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-cyan-400">
              <Landmark size={13} /> Brasil — PIX, boleto e cartão
            </p>
            <div className="mt-3 space-y-3 text-xs leading-relaxed text-slate-400">
              <p>
                <strong className="text-white">1. Asaas (recomendação principal)</strong> — cobre PIX, boleto e
                cartão numa API só, com <em>assinatura recorrente nativa</em> (ideal para mensalidade SaaS),
                webhook de confirmação e conta digital inclusa. PIX na faixa de R$0,99–1,99 por recebimento,
                boleto ~R$1,99–3,49, cartão à vista ~2,99–4,99%. Integração simples (uma API key).
              </p>
              <p>
                <strong className="text-white">2. Mercado Pago</strong> — taxas competitivas (PIX ~0,99%),
                marca que o cliente final conhece (ajuda conversão), API boa e sem mensalidade. Recorrência
                exige o recurso de assinaturas deles.
              </p>
              <p>
                <strong className="text-white">3. Pagar.me</strong> — muito usado em e-commerce BR, API
                robusta, multi-adquirência e retentativa de cobrança. Faz sentido quando o volume crescer;
                taxas por negociação.
              </p>
              <p className="text-slate-500">
                Nota: a Cora (usada em outro projeto seu para boleto) também emite boleto com API, mas não
                cobre cartão — para o combo PIX+boleto+cartão numa integração só, as três acima são melhores.
              </p>
            </div>
          </div>

          {/* EUA */}
          <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-cyan-400">
              <CreditCard size={13} /> EUA — cartão
            </p>
            <div className="mt-3 space-y-3 text-xs leading-relaxed text-slate-400">
              <p>
                <strong className="text-white">Stripe (cartão)</strong> — padrão do mercado para SaaS:
                cartão de débito/crédito com cobrança recorrente (Billing), checkout pronto e webhooks.
                ~2,9% + US$0,30 por transação. É a forma de automatizar 100% a mensalidade nos EUA.
              </p>
            </div>
          </div>
        </div>

        <p className="mt-4 text-[11px] text-slate-600">
          Importante: preencher a API key aqui e marcar &quot;Ativo&quot; já liga a cobrança automática de
          verdade — o próximo cadastro nessa região vai gerar uma cobrança real (Asaas: assinatura mensal;
          Stripe: Checkout Session recorrente). O acesso do cliente nunca fica bloqueado por falha ou ausência
          de processadora — a cobrança fica pendente em Cobranças até ser resolvida manualmente.
        </p>
      </Card>

      {/* ─── CREDENCIAIS BR ─── */}
      <div>
        <h2 className="mb-3 text-sm font-black text-white">🇧🇷 Brasil</h2>
        <PaymentGatewayForm region="BR" rows={brRows} tableMissing={tableMissing} />
      </div>

      {/* ─── CREDENCIAIS US ─── */}
      <div>
        <h2 className="mb-3 text-sm font-black text-white">🇺🇸 Estados Unidos</h2>
        <PaymentGatewayForm region="US" rows={usRows} tableMissing={tableMissing} />
      </div>
    </div>
  )
}
