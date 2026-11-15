import { redirect } from 'next/navigation'
import { AlertTriangle, CheckCircle2, ExternalLink, HeartPulse, XCircle } from 'lucide-react'
import { getAppUser } from '@/lib/app-user'
import { createClient } from '@/lib/supabase/server'
import { getIntegrationsConfigStatus } from '@/lib/integrations'
import { IntegrationHealthButton } from '@/components/dashboard/integration-health-button'

export const dynamic = 'force-dynamic'

type EventRow = {
  id: string
  level: string
  source: string
  event_type: string
  message: string
  created_at: string
}

type KaiTaskRow = {
  id: string
  kind: string
  title: string
  description: string
  status: string
  priority: string
  due_at: string | null
  created_at: string
}

export default async function SystemHealthPage() {
  const appUser = await getAppUser()
  if (!appUser?.isSuperAdmin) redirect('/dashboard')
  const supabase = await createClient()
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: events }, { data: gateways }, { data: units }, { data: usage }, { data: kaiTasks }, { data: agentConfigs }] = await Promise.all([
    supabase.from('system_events').select('id, level, source, event_type, message, created_at').in('level', ['warning', 'error']).gte('created_at', since).order('created_at', { ascending: false }).limit(100),
    supabase.from('payment_gateway_settings').select('provider, region, is_active').order('region'),
    supabase.from('units').select('id, name, is_active, whatsapp_phone').eq('is_active', true),
    supabase.from('api_usage_events').select('provider, estimated_cost_usd').gte('created_at', since).limit(20000),
    supabase.from('kai_tasks').select('id, kind, title, description, status, priority, due_at, created_at').in('status', ['open', 'in_progress', 'waiting_human']).order('priority').order('created_at', { ascending: false }).limit(100),
    supabase.from('agent_configs').select('id, is_active, certification_status').eq('is_active', true),
  ])

  const rows = (events ?? []) as EventRow[]
  const integrations = getIntegrationsConfigStatus()
  const unitRows = (units ?? []) as { id: string; name: string; whatsapp_phone: string | null }[]
  const taskRows = (kaiTasks ?? []) as KaiTaskRow[]
  const activeConfigs = (agentConfigs ?? []) as { id: string; certification_status: string }[]
  const certifiedConfigs = activeConfigs.filter((config) => config.certification_status === 'ready')
  const costsByProvider = ((usage ?? []) as { provider: string; estimated_cost_usd: number | null }[]).reduce<Record<string, number>>(
    (sum, row) => ({ ...sum, [row.provider]: (sum[row.provider] ?? 0) + Number(row.estimated_cost_usd ?? 0) }),
    {},
  )
  const groups = rows.reduce<Record<string, { count: number; last: EventRow }>>((acc, event) => {
    const key = event.source
    const current = acc[key]
    acc[key] = current ? { count: current.count + 1, last: current.last } : { count: 1, last: event }
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-400">Super Admin</p>
          <h1 className="mt-1 text-2xl font-black text-white">Saúde do sistema</h1>
          <p className="mt-1 text-sm text-slate-400">Integrações, custos e falhas que podem interromper o trabalho dos clientes.</p>
        </div>
        <IntegrationHealthButton />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Integrações configuradas" value={`${integrations.filter((item) => item.configured).length}/${integrations.length}`} ok={integrations.every((item) => item.configured)} />
        <Metric label="WhatsApps cadastrados" value={`${unitRows.filter((unit) => unit.whatsapp_phone).length}/${unitRows.length}`} ok={unitRows.length > 0 && unitRows.every((unit) => unit.whatsapp_phone)} />
        <Metric label="Falhas em 7 dias" value={String(rows.length)} ok={rows.length === 0} />
        <Metric label="Custo de IA em 7 dias" value={`US$ ${(costsByProvider.openai ?? 0).toFixed(2)}`} ok />
        <Metric label="Google Maps em 7 dias" value={`US$ ${(costsByProvider.google_maps ?? 0).toFixed(2)}`} ok />
        <Metric label="Funcionários certificados" value={`${certifiedConfigs.length}/${activeConfigs.length}`} ok={activeConfigs.length > 0 && certifiedConfigs.length === activeConfigs.length} />
        <Metric label="Pendências da Kai" value={String(taskRows.length)} ok={taskRows.length === 0} />
      </div>

      <section className="rounded-2xl border border-white/10 bg-[#141a2b] p-5">
        <h2 className="text-sm font-black text-white">Supervisão central da Kai</h2>
        <p className="mt-1 text-xs text-slate-400">Pendências operacionais abertas automaticamente, sem permitir que a IA execute reparos ou amplie permissões sozinha.</p>
        <div className="mt-4 space-y-2">
          {taskRows.length === 0 ? (
            <p className="text-sm text-green-400">Nenhuma pendência operacional aberta.</p>
          ) : taskRows.map((task) => (
            <div key={task.id} className={`rounded-xl border p-3 ${task.priority === 'critical' ? 'border-red-500/25 bg-red-500/[0.07]' : 'border-amber-500/20 bg-amber-500/[0.06]'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-white">{task.title}</p>
                  <p className="mt-1 text-xs text-slate-300">{task.description}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${task.priority === 'critical' ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>
                  {task.priority === 'critical' ? 'crítica' : task.priority}
                </span>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">{task.kind} · {task.status === 'waiting_human' ? 'aguardando revisão humana' : task.status} · aberta em {new Date(task.created_at).toLocaleString('pt-BR')}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#141a2b] p-5">
        <h2 className="text-sm font-black text-white">Pagamentos e saldo das integrações</h2>
        <p className="mt-1 text-xs text-slate-400">Os valores abaixo são estimativas registradas pelo Alizo. Saldo, créditos e forma de pagamento oficiais ficam no painel de cada fornecedor.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <ProviderCostCard
            name="OpenAI — inteligência artificial"
            value={costsByProvider.openai ?? 0}
            href="https://platform.openai.com/settings/organization/billing/overview"
            linkLabel="Abrir pagamentos da OpenAI"
          />
          <ProviderCostCard
            name="Google Maps — prospecção"
            value={costsByProvider.google_maps ?? 0}
            href="https://console.cloud.google.com/billing"
            linkLabel="Abrir pagamentos do Google Maps"
          />
        </div>
        <p className="mt-3 text-[11px] text-slate-500">Avisos por e-mail são enviados quando o gasto mensal estimado atinge 80% do limite configurado no servidor.</p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#141a2b] p-5">
        <h2 className="flex items-center gap-2 text-sm font-black text-white"><HeartPulse size={16} className="text-cyan-400" /> Dependências essenciais</h2>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {integrations.map((item) => (
            <div key={item.key} className="rounded-xl border border-white/10 bg-white/[0.02] p-3" title={item.detail}>
              <div className="flex items-center gap-2">
                {item.configured ? <CheckCircle2 size={14} className="text-green-400" /> : <XCircle size={14} className="text-red-400" />}
                <p className="text-xs font-bold text-white">{item.label}</p>
              </div>
              <p className={`mt-1 text-[11px] ${item.configured ? 'text-green-400' : 'text-red-400'}`}>
                {item.configured ? 'Configurada' : 'Ausente — recurso indisponível'}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#141a2b] p-5">
        <h2 className="text-sm font-black text-white">Cobrança da plataforma</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(['BR', 'US'] as const).map((region) => {
            const gateway = (gateways ?? []).find((row) => row.region === region && row.is_active)
            return <Metric key={region} label={region === 'BR' ? 'Brasil' : 'Estados Unidos'} value={gateway ? `${gateway.provider} ativo` : 'sem processadora ativa'} ok={Boolean(gateway)} />
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#141a2b] p-5">
        <h2 className="text-sm font-black text-white">Falhas agrupadas — últimos 7 dias</h2>
        <div className="mt-3 space-y-2">
          {Object.entries(groups).length === 0 ? <p className="text-sm text-green-400">Nenhuma falha registrada.</p> : Object.entries(groups).map(([source, value]) => (
            <div key={source} className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 text-amber-400" />
                <div>
                  <p className="text-xs font-bold text-white">{source} · {value.count} ocorrência{value.count === 1 ? '' : 's'}</p>
                  <p className="mt-1 text-xs text-slate-300">{value.last.message}</p>
                  <p className="mt-1 text-[10px] text-slate-500">{new Date(value.last.created_at).toLocaleString('pt-BR')}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function ProviderCostCard({ name, value, href, linkLabel }: { name: string; value: number; href: string; linkLabel: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <p className="text-xs font-bold text-white">{name}</p>
      <p className="mt-2 text-xl font-black text-cyan-300">US$ {value.toFixed(2)}</p>
      <p className="text-[10px] text-slate-500">uso estimado nos últimos 7 dias</p>
      <a href={href} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-cyan-400 hover:text-cyan-300">
        {linkLabel} <ExternalLink size={12} />
      </a>
    </div>
  )
}

function Metric({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#141a2b] p-4">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        {ok ? <CheckCircle2 size={15} className="text-green-400" /> : <AlertTriangle size={15} className="text-amber-400" />}
        <p className="text-sm font-black text-white">{value}</p>
      </div>
    </div>
  )
}
