import { createClient } from '@/lib/supabase/server'
import { formatCentsBRL } from '@/lib/traffic/metrics'
import { isExecutable } from '@/lib/traffic/executor'
import type {
  AdAccount,
  AdActionLog,
  AdEntity,
  MetricsSnapshot,
  TrafficDecision,
  TrafficDecisionSeverity,
  TrafficReport,
} from '@/lib/traffic/types'
import {
  Badge,
  type BadgeVariant,
  Card,
  CardHeader,
  PageHeader,
  TableShell,
  Td,
  Th,
  Tr,
} from '@/components/ui/dashboard-ui'
import { TrafficDecisionActions } from '@/components/dashboard/traffic-decision-actions'

export const dynamic = 'force-dynamic'

const SEVERITY_VARIANT: Record<TrafficDecisionSeverity, BadgeVariant> = {
  info: 'blue',
  warning: 'amber',
  critical: 'red',
}

const DECISION_TYPE_LABEL: Record<string, string> = {
  pause_entity: 'Pausar',
  resume_entity: 'Reativar',
  increase_budget: 'Aumentar orçamento',
  decrease_budget: 'Reduzir orçamento',
  reallocate_budget: 'Realocar verba',
  change_bid_strategy: 'Estratégia de lance',
  refresh_creative: 'Trocar criativo',
  new_audience_suggestion: 'Novo público',
  landing_page_suggestion: 'Landing page / pixel',
  anomaly_alert: 'Anomalia',
  funnel_rebalance: 'Rebalancear funil',
  seasonal_adjustment: 'Ajuste sazonal',
  policy_risk_alert: 'Risco de política',
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  connected: 'green',
  pending_credentials: 'amber',
  error: 'red',
  disconnected: 'slate',
}

const STATUS_LABEL: Record<string, string> = {
  connected: 'Conectada',
  pending_credentials: 'Aguardando credenciais',
  error: 'Erro',
  disconnected: 'Desconectada',
}

const ENTITY_STATUS_VARIANT: Record<string, BadgeVariant> = {
  ACTIVE: 'green',
  PAUSED: 'amber',
  ARCHIVED: 'slate',
  REMOVED: 'slate',
  UNKNOWN: 'slate',
}

function platformLabel(platform: string): string {
  return platform === 'meta' ? 'Meta Ads' : 'Google Ads'
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black tracking-tight text-white">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </Card>
  )
}

export default async function TrafficPage() {
  const supabase = await createClient()

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [accountsRes, entitiesRes, snapshotsRes, decisionsRes, actionsRes, reportsRes] =
    await Promise.all([
      supabase.from('ad_accounts').select('*').order('created_at', { ascending: false }),
      supabase
        .from('ad_entities')
        .select('*')
        .eq('entity_level', 'campaign')
        .order('daily_budget_cents', { ascending: false, nullsFirst: false })
        .limit(50),
      supabase
        .from('ad_metrics_snapshots')
        .select('*')
        .gte('snapshot_date', sevenDaysAgo)
        .limit(2000),
      supabase
        .from('traffic_decisions')
        .select('*')
        .in('status', ['suggested', 'approved', 'executed', 'failed'])
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('ad_actions_log').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('traffic_reports').select('*').order('created_at', { ascending: false }).limit(3),
    ])

  const accounts = (accountsRes.data ?? []) as AdAccount[]
  const campaigns = (entitiesRes.data ?? []) as AdEntity[]
  const snapshots = (snapshotsRes.data ?? []) as MetricsSnapshot[]
  const decisions = (decisionsRes.data ?? []) as TrafficDecision[]
  const actions = (actionsRes.data ?? []) as AdActionLog[]
  const reports = (reportsRes.data ?? []) as TrafficReport[]

  // KPIs dos últimos 7 dias (todas as contas visíveis ao usuário)
  const totals = snapshots.reduce(
    (acc, row) => ({
      spend: acc.spend + row.spend_cents,
      conversions: acc.conversions + Number(row.conversions),
      value: acc.value + row.conversion_value_cents,
      clicks: acc.clicks + row.clicks,
      impressions: acc.impressions + row.impressions,
    }),
    { spend: 0, conversions: 0, value: 0, clicks: 0, impressions: 0 },
  )
  const roas = totals.spend > 0 ? totals.value / totals.spend : null
  const cpa = totals.conversions > 0 ? Math.round(totals.spend / totals.conversions) : null
  const pendingDecisions = decisions.filter((d) => d.status === 'suggested')

  // Agregado 7d por campanha para a tabela
  const byEntity = new Map<string, { spend: number; conversions: number; value: number; clicks: number; impressions: number }>()
  for (const row of snapshots) {
    const agg = byEntity.get(row.entity_id) ?? { spend: 0, conversions: 0, value: 0, clicks: 0, impressions: 0 }
    agg.spend += row.spend_cents
    agg.conversions += Number(row.conversions)
    agg.value += row.conversion_value_cents
    agg.clicks += row.clicks
    agg.impressions += row.impressions
    byEntity.set(row.entity_id, agg)
  }

  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const entityById = new Map(campaigns.map((entity) => [entity.id, entity]))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="funcionário digital"
        title="Especialista em Tráfego Pago"
        subtitle="Ele cuida dos seus anúncios no Instagram/Facebook e no Google: acompanha todo dia, sugere melhorias e registra tudo o que faz."
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="Investimento (7d)" value={formatCentsBRL(totals.spend)} hint="gasto em anúncios na semana" />
        <KpiCard label="Conversões (7d)" value={String(Math.round(totals.conversions))} hint="pessoas que viraram contato/venda" />
        <KpiCard label="Retorno (ROAS)" value={roas !== null ? `${roas.toFixed(2)}x` : '—'} hint={roas !== null ? `cada R$1 investido voltou R$${roas.toFixed(2)}` : 'retorno por real investido'} />
        <KpiCard label="Custo por conversão" value={formatCentsBRL(cpa)} hint="quanto custa cada cliente" />
        <KpiCard
          label="Decisões pendentes"
          value={String(pendingDecisions.length)}
          hint={pendingDecisions.some((d) => d.severity === 'critical') ? 'Há itens críticos' : undefined}
        />
      </div>

      {/* Relatório executivo mais recente */}
      {reports.length > 0 && (
        <Card className="p-6">
          <CardHeader eyebrow="relatório executivo" title={`${accountById.get(reports[0]!.ad_account_id)?.name ?? 'Conta'} — ${platformLabel(accountById.get(reports[0]!.ad_account_id)?.platform ?? 'meta')}`} />
          <p className="text-sm leading-relaxed text-slate-300">{reports[0]!.summary}</p>
        </Card>
      )}

      {/* Contas conectadas */}
      <Card className="overflow-hidden">
        <div className="px-6 pt-5">
          <CardHeader eyebrow="contas de anúncio" title="Contas conectadas" />
        </div>
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <p className="text-sm font-bold text-white">Suas contas de anúncio ainda não estão conectadas</p>
            <p className="max-w-lg text-sm text-slate-400">
              Pra esse funcionário trabalhar, a equipe Alizo conecta com você as contas de anúncio da
              sua empresa (Facebook/Instagram e Google). É uma configuração única, feita junto — leva
              cerca de 15 minutos.
            </p>
            <a
              href="mailto:suporte@alizo.com.br?subject=Quero%20conectar%20minhas%20contas%20de%20an%C3%BAncio"
              className="mt-2 rounded-xl px-5 py-2.5 text-sm font-black text-white"
              style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 12px rgba(6,182,212,0.25)' }}
            >
              Agendar conexão com a equipe
            </a>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <TableShell>
              <Th>Conta</Th>
              <Th>Plataforma</Th>
              <Th>Status</Th>
              <Th>Modo</Th>
              <Th>Último sync</Th>
            </TableShell>
            <tbody>
              {accounts.map((account) => (
                <Tr key={account.id}>
                  <Td>
                    <span className="font-semibold text-white">{account.name}</span>
                    <span className="ml-2 text-xs text-slate-500">{account.external_account_id}</span>
                  </Td>
                  <Td className="text-slate-400">{platformLabel(account.platform)}</Td>
                  <Td>
                    <Badge variant={STATUS_VARIANT[account.connection_status] ?? 'slate'}>
                      {STATUS_LABEL[account.connection_status] ?? account.connection_status}
                    </Badge>
                    {account.connection_error && (
                      <p className="mt-1 max-w-md text-[11px] text-red-400">{account.connection_error}</p>
                    )}
                  </Td>
                  <Td>
                    <Badge variant={account.optimization_mode === 'autonomous' ? 'purple' : 'cyan'}>
                      {account.optimization_mode === 'autonomous' ? 'Autônomo' : 'Sugestão'}
                    </Badge>
                  </Td>
                  <Td className="text-slate-400">
                    {account.last_synced_at
                      ? new Date(account.last_synced_at).toLocaleString('pt-BR')
                      : 'nunca'}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Decisões do motor */}
      <Card className="overflow-hidden">
        <div className="px-6 pt-5">
          <CardHeader
            eyebrow="motor de estratégia"
            title="Decisões e recomendações"
          />
        </div>
        {decisions.length === 0 ? (
          <div className="px-6 pb-8 text-sm text-slate-400">
            Nada por aqui ainda. Assim que as contas estiverem conectadas, as recomendações do
            especialista aparecem nesta lista todos os dias — e você aprova ou recusa cada uma.
          </div>
        ) : (
          <div className="flex flex-col">
            {decisions.map((decision) => {
              const entity = decision.entity_id ? entityById.get(decision.entity_id) : null
              const account = accountById.get(decision.ad_account_id)
              return (
                <div
                  key={decision.id}
                  className="flex items-start justify-between gap-4 px-6 py-4"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={SEVERITY_VARIANT[decision.severity]}>
                        {DECISION_TYPE_LABEL[decision.decision_type] ?? decision.decision_type}
                      </Badge>
                      {decision.status !== 'suggested' && (
                        <Badge
                          variant={
                            decision.status === 'executed'
                              ? 'green'
                              : decision.status === 'failed'
                                ? 'red'
                                : decision.status === 'rejected'
                                  ? 'slate'
                                  : 'blue'
                          }
                        >
                          {decision.status}
                        </Badge>
                      )}
                      <span className="text-xs text-slate-500">
                        {account ? `${account.name} · ${platformLabel(account.platform)}` : ''}
                        {entity ? ` · ${entity.name}` : ''}
                        {' · '}
                        {new Date(decision.created_at).toLocaleString('pt-BR')}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">{decision.reasoning}</p>
                    {decision.decided_by && (
                      <p className="mt-1 text-[11px] text-slate-500">Decidido por {decision.decided_by}</p>
                    )}
                  </div>
                  {decision.status === 'suggested' && (
                    <TrafficDecisionActions
                      decisionId={decision.id}
                      executable={isExecutable(decision.recommended_action)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Campanhas */}
      <Card className="overflow-hidden">
        <div className="px-6 pt-5">
          <CardHeader eyebrow="performance 7 dias" title="Campanhas monitoradas" />
        </div>
        {campaigns.length === 0 ? (
          <div className="px-6 pb-8 text-sm text-slate-400">
            Nenhuma campanha sincronizada ainda.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <TableShell>
              <Th>Campanha</Th>
              <Th>Plataforma</Th>
              <Th>Status</Th>
              <Th>Orçamento/dia</Th>
              <Th>Gasto 7d</Th>
              <Th>Conv.</Th>
              <Th>CPA</Th>
              <Th>ROAS</Th>
            </TableShell>
            <tbody>
              {campaigns.map((campaign) => {
                const agg = byEntity.get(campaign.id)
                const campaignCpa =
                  agg && agg.conversions > 0 ? Math.round(agg.spend / agg.conversions) : null
                const campaignRoas = agg && agg.spend > 0 ? agg.value / agg.spend : null
                return (
                  <Tr key={campaign.id}>
                    <Td>
                      <span className="font-semibold text-white">{campaign.name}</span>
                      {campaign.funnel_stage && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-500">
                          {campaign.funnel_stage}
                        </span>
                      )}
                    </Td>
                    <Td className="text-slate-400">{platformLabel(campaign.platform)}</Td>
                    <Td>
                      <Badge variant={ENTITY_STATUS_VARIANT[campaign.status] ?? 'slate'}>
                        {campaign.status}
                      </Badge>
                    </Td>
                    <Td className="text-slate-400">{formatCentsBRL(campaign.daily_budget_cents)}</Td>
                    <Td className="text-slate-400">{agg ? formatCentsBRL(agg.spend) : '—'}</Td>
                    <Td className="text-slate-400">{agg ? Math.round(agg.conversions) : '—'}</Td>
                    <Td className="text-slate-400">{formatCentsBRL(campaignCpa)}</Td>
                    <Td className="text-slate-400">
                      {campaignRoas !== null ? campaignRoas.toFixed(2) : '—'}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Auditoria */}
      <Card className="overflow-hidden">
        <div className="px-6 pt-5">
          <CardHeader
            eyebrow="auditoria"
            title="Ações executadas nas contas"
          />
        </div>
        {actions.length === 0 ? (
          <div className="px-6 pb-8 text-sm text-slate-400">
            Nenhuma ação executada ainda. Toda mudança feita numa conta real fica registrada aqui,
            com payload, estado anterior e resposta da plataforma.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <TableShell>
              <Th>Quando</Th>
              <Th>Ação</Th>
              <Th>Entidade</Th>
              <Th>Resultado</Th>
              <Th>Executor</Th>
            </TableShell>
            <tbody>
              {actions.map((action) => {
                const entity = action.entity_id ? entityById.get(action.entity_id) : null
                return (
                  <Tr key={action.id}>
                    <Td className="text-slate-400">
                      {new Date(action.created_at).toLocaleString('pt-BR')}
                    </Td>
                    <Td className="font-semibold text-white">{action.action_type}</Td>
                    <Td className="text-slate-400">{entity?.name ?? '—'}</Td>
                    <Td>
                      <Badge
                        variant={
                          action.result === 'success'
                            ? 'green'
                            : action.result === 'dry_run'
                              ? 'blue'
                              : 'red'
                        }
                      >
                        {action.result}
                      </Badge>
                      {action.error_message && (
                        <p className="mt-1 max-w-md text-[11px] text-red-400">{action.error_message}</p>
                      )}
                    </Td>
                    <Td className="text-slate-400">{action.executed_by}</Td>
                  </Tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
