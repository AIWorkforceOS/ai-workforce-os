import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  MessageSquare, ShoppingCart, DollarSign, UserX, Rocket, Undo2,
  Bot, Smartphone, MapPin, Mail, BarChart3,
} from 'lucide-react'
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/dashboard-ui'
import { AutoRefresh } from '@/components/admin/auto-refresh'
import {
  getMonthApiCosts, getRealtimeOverview, getRecentApiIssues, looksLikeQuotaIssue,
} from '@/lib/admin-metrics'
import { fetchOpenAIRealCost } from '@/lib/openai-costs'

export const dynamic = 'force-dynamic'

function fmtBrl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtUsd(v: number) {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: v < 1 ? 4 : 2 })
}

function fmtMoney(brl: number, usd: number) {
  if (usd > 0 && brl > 0) return `${fmtBrl(brl)} + ${fmtUsd(usd)}`
  if (usd > 0) return fmtUsd(usd)
  return fmtBrl(brl)
}

type ApiCardDef = {
  key: 'openai' | 'evolution' | 'google_maps' | 'resend'
  label: string
  icon: typeof Bot
  configured: boolean
  costNote: string
}

export default async function SalesPage() {
  const supabase = await createClient()
  const now = new Date()

  const [overview, apiCosts, issues, openaiReal, orgsRes] = await Promise.all([
    getRealtimeOverview(supabase),
    getMonthApiCosts(supabase),
    getRecentApiIssues(supabase),
    fetchOpenAIRealCost({ from: new Date(now.getFullYear(), now.getMonth(), 1) }),
    supabase.from('organizations').select('id, name, plan, is_active, created_at').order('created_at', { ascending: false }),
  ])

  const orgs = (orgsRes.data ?? []) as { id: string; name: string; plan: string; is_active: boolean; created_at: string }[]

  // ─── Cards do dia/semana ───
  const kpis = [
    {
      label: 'Conversas hoje',
      value: String(overview.conversationsToday.leads),
      sub: `${overview.conversationsToday.messages} mensagens em todas as unidades`,
      icon: MessageSquare,
      grad: 'from-cyan-400 to-blue-500',
    },
    {
      label: 'Vendas na semana',
      value: String(overview.salesWeek.count),
      sub: `checkouts fechados · ${fmtMoney(overview.salesWeek.totalBrl, overview.salesWeek.totalUsd)} vendidos`,
      icon: ShoppingCart,
      grad: 'from-violet-400 to-purple-500',
    },
    {
      label: 'Arrecadado na semana',
      value: fmtMoney(overview.collectedWeek.totalBrl, overview.collectedWeek.totalUsd),
      sub: 'só o que foi marcado como pago',
      icon: DollarSign,
      grad: 'from-emerald-400 to-green-500',
    },
    {
      label: 'Cancelamentos na semana',
      value: overview.cancellationsWeek === null ? '—' : String(overview.cancellationsWeek),
      sub: overview.cancellationsWeek === null ? 'aplique a migration 010 para habilitar' : 'empresas desativadas',
      icon: UserX,
      grad: 'from-rose-400 to-red-500',
    },
    {
      label: 'Onboardings na semana',
      value: String(overview.onboardingsWeek),
      sub: 'unidades que ativaram o 1º agente (aprox.)',
      icon: Rocket,
      grad: 'from-amber-400 to-orange-500',
    },
    {
      label: 'A devolver (garantia 7d)',
      value: fmtMoney(overview.refundsDue.totalBrl, overview.refundsDue.totalUsd),
      sub: overview.refundsDue.orgs.length > 0
        ? `${overview.refundsDue.orgs.length} cancelamento(s) dentro da garantia`
        : 'nenhum reembolso pendente',
      icon: Undo2,
      grad: 'from-slate-400 to-slate-500',
    },
  ]

  // ─── Cards por API ───
  const costByProvider = new Map((apiCosts ?? []).map((c) => [c.provider, c]))
  const issuesBySource = (source: string, extra: string[] = []) =>
    issues.filter((i) => i.source === source || extra.includes(i.source))

  const apiCards: ApiCardDef[] = [
    {
      key: 'openai',
      label: 'OpenAI',
      icon: Bot,
      configured: Boolean(process.env.OPENAI_API_KEY),
      costNote: openaiReal ? 'custo real (Costs API)' : 'estimado por tokens registrados',
    },
    {
      key: 'evolution',
      label: 'Evolution (WhatsApp)',
      icon: Smartphone,
      configured: Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY),
      costNote: 'self-hosted — custo por mensagem R$ 0 (infra fixa)',
    },
    {
      key: 'google_maps',
      label: 'Google Maps',
      icon: MapPin,
      configured: Boolean(process.env.GOOGLE_MAPS_API_KEY),
      costNote: 'estimado por requests registrados',
    },
    {
      key: 'resend',
      label: 'Resend (e-mail)',
      icon: Mail,
      configured: Boolean(process.env.RESEND_API_KEY),
      costNote: 'estimado por e-mails enviados',
    },
  ]

  // ─── Novos clientes 7 dias (mantido do painel anterior) ───
  const dayBuckets: { date: string; count: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now)
    day.setDate(now.getDate() - i)
    day.setHours(0, 0, 0, 0)
    const nextDay = new Date(day)
    nextDay.setDate(day.getDate() + 1)
    const count = orgs.filter((o) => {
      const d = new Date(o.created_at)
      return d >= day && d < nextDay
    }).length
    dayBuckets.push({ date: day.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' }), count })
  }
  const maxCount = Math.max(...dayBuckets.map((d) => d.count), 1)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="operação alizo"
        title="Visão geral da plataforma"
        subtitle={now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        action={<AutoRefresh intervalSeconds={30} />}
      />

      {/* KPIs do dia / semana */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map(({ label, value, sub, icon: Icon, grad }) => (
          <div
            key={label}
            className="relative overflow-hidden rounded-2xl bg-[#141a2b]"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
          >
            <div className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${grad}`} />
            <div className="p-4 pt-5">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${grad}`}
                style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}
              >
                <Icon size={15} className="text-white" />
              </div>
              <p className="mt-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">{label}</p>
              <p className="mt-1 text-xl font-black tracking-tight text-white">{value}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Reembolsos da garantia, quando existirem */}
      {overview.refundsDue.orgs.length > 0 && (
        <Card className="p-5">
          <CardHeader eyebrow="garantia de 7 dias" title="Reembolsos a fazer (manual)" />
          <div className="space-y-2">
            {overview.refundsDue.orgs.map((org) => (
              <div key={org.name} className="flex items-center justify-between text-sm">
                <span className="font-semibold text-white">{org.name}</span>
                <span className="font-black text-rose-400">{fmtMoney(org.amountBrl, org.amountUsd)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Valor derivado das datas de cadastro e cancelamento (pago dentro de 7 dias da compra). O estorno em si ainda é manual na processadora.
          </p>
        </Card>
      )}

      {/* Saúde e custo por API */}
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">integrações</p>
            <h2 className="text-sm font-bold text-white">Custo e saúde das APIs — mês atual</h2>
          </div>
          <p className="text-[11px] text-slate-500">
            valores estimados a partir do uso registrado pelo sistema{openaiReal ? ' · OpenAI: custo real' : ''}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {apiCards.map(({ key, label, icon: Icon, configured, costNote }) => {
            const cost = costByProvider.get(key)
            const cardIssues = issuesBySource(key === 'google_maps' ? 'google_maps' : key)
            const errors = cardIssues.filter((i) => i.level === 'error')
            const quotaIssue = cardIssues.some((i) => looksLikeQuotaIssue(i.message))

            const status = !configured
              ? { label: 'Ação: configurar', color: '#f87171', dot: '#f87171' }
              : quotaIssue
                ? { label: 'Ação: verificar créditos', color: '#fbbf24', dot: '#fbbf24' }
                : errors.length > 0
                  ? { label: `${errors.length} erro(s) em 24h`, color: '#fbbf24', dot: '#fbbf24' }
                  : { label: 'Operacional', color: '#4ade80', dot: '#4ade80' }

            const costValue =
              key === 'openai' && openaiReal
                ? fmtUsd(openaiReal.amountUsd)
                : key === 'evolution'
                  ? 'R$ 0,00'
                  : cost
                    ? fmtUsd(cost.estimatedCostUsd)
                    : apiCosts === null
                      ? '—'
                      : fmtUsd(0)

            return (
              <Card key={key} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-lg"
                      style={{ background: 'rgba(6,182,212,0.12)' }}
                    >
                      <Icon size={14} className="text-cyan-400" />
                    </div>
                    <span className="text-sm font-bold text-white">{label}</span>
                  </div>
                  <span className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: status.color }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.dot }} />
                    {status.label}
                  </span>
                </div>

                <p className="mt-3 text-2xl font-black tracking-tight text-white">{costValue}</p>
                <p className="text-[11px] text-slate-500">{costNote}</p>

                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  {cost && <span>{cost.requests.toLocaleString('pt-BR')} chamadas</span>}
                  {cost && cost.totalTokens > 0 && <span>{cost.totalTokens.toLocaleString('pt-BR')} tokens</span>}
                  {!configured && <span className="text-rose-400">env var não configurada</span>}
                  {apiCosts === null && configured && (
                    <span className="text-amber-400">migration 010 pendente — sem registro de uso</span>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Tendência + últimos clientes */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader eyebrow="tendência" title="Novos clientes — últimos 7 dias" />
          <div className="flex h-32 items-end gap-3">
            {dayBuckets.map(({ date, count }) => (
              <div key={date} className="flex flex-1 flex-col items-center gap-1.5">
                <div
                  className="w-full rounded-t-lg transition-all duration-500"
                  style={{
                    height: `${count === 0 ? 8 : (count / maxCount) * 100}%`,
                    background:
                      count > 0 ? 'linear-gradient(180deg, #22d3ee 0%, #4361ee 100%)' : 'rgba(255,255,255,0.06)',
                    minHeight: 8,
                  }}
                />
                <span className="text-[10px] font-bold text-slate-400">{count}</span>
                <span className="text-[9px] text-slate-600">{date}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">recentes</p>
              <h2 className="text-sm font-bold text-white">Últimos clientes</h2>
            </div>
            <Link href="/dashboard/organizations" className="text-[11px] font-semibold" style={{ color: '#06b6d4' }}>
              Ver todos →
            </Link>
          </div>

          {orgs.length === 0 ? (
            <div className="p-8 text-center">
              <BarChart3 size={28} className="mx-auto text-slate-600" />
              <p className="mt-3 text-sm text-slate-400">Nenhum cliente cadastrado ainda</p>
              <p className="text-xs text-slate-600">As vendas aparecerão aqui automaticamente</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              {orgs.slice(0, 6).map((org) => (
                <div key={org.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{org.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {new Date(org.created_at).toLocaleDateString('pt-BR', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="purple">{org.plan}</Badge>
                    <Badge variant={org.is_active ? 'green' : 'slate'}>{org.is_active ? 'Ativo' : 'Inativo'}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-600">
        <strong className="text-slate-500">O que é exato e o que é estimado:</strong> conversas, vendas, valores
        arrecadados e cancelamentos vêm direto do banco (exatos). Onboardings usam a ativação do 1º agente como
        aproximação da conclusão. Custos de API são estimados pela nossa contagem de tokens/chamadas com preço público
        de tabela — a fatura real pode divergir. Com a env <code>OPENAI_ADMIN_KEY</code>, o card da OpenAI mostra o
        custo real da Costs API.
      </p>
    </div>
  )
}
