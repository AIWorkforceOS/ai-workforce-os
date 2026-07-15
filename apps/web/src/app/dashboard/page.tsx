import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { computeSetupStatus } from '@/lib/setup-status'
import { LeadsByDayChart } from '@/components/dashboard/leads-by-day-chart'
import { IntegrationsStatusCard } from '@/components/dashboard/integrations-status'
import { Badge, Card, PrimaryButton } from '@/components/ui/dashboard-ui'
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  Megaphone,
  MessageSquare,
  Rocket,
  Users,
  WifiOff,
} from 'lucide-react'
import type { AgentConfig, DashboardSummaryRow, Organization, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

function startOfDay(date: Date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(now),
  )
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export default async function DashboardPage() {
  const appUser = await getAppUser()
  if (appUser?.isSuperAdmin) {
    return <AdminHome firstName={(appUser.name ?? appUser.email).split(/[\s@]/)[0] ?? 'time'} />
  }
  return <ClientHome firstName={(appUser?.name ?? appUser?.email ?? 'você').split(/[\s@]/)[0] ?? 'você'} />
}

// ─────────────────────────────────────────────────────────────────────────────
// Visão da EMPRESA CLIENTE — linguagem de dono de negócio, foco em
// "o que está acontecendo" e "o que fazer agora".
// ─────────────────────────────────────────────────────────────────────────────

async function ClientHome({ firstName }: { firstName: string }) {
  const supabase = await createClient()
  const now = new Date()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const todayStart = startOfDay(now)
  const sevenDaysAgo = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000))

  const [
    { data: units },
    { data: agentConfigs },
    { count: totalLeads },
    { count: newLeads24h },
    { count: wonLeads },
    { count: conversationsToday },
    { data: recentLeads },
    { count: openJobs },
    { count: adAccounts },
  ] = await Promise.all([
    supabase.from('units').select('*').order('created_at', { ascending: true }),
    supabase.from('agent_configs').select('*'),
    supabase.from('leads').select('id', { count: 'exact', head: true }),
    supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', since24h.toISOString()),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'won'),
    supabase.from('conversations').select('id', { count: 'exact', head: true }).gte('sent_at', todayStart.toISOString()),
    supabase.from('leads').select('created_at').gte('created_at', sevenDaysAgo.toISOString()),
    supabase.from('job_openings').select('id', { count: 'exact', head: true }),
    supabase.from('ad_accounts').select('id', { count: 'exact', head: true }),
  ])

  const unitRows = (units ?? []) as Unit[]
  const configRows = (agentConfigs ?? []) as AgentConfig[]
  const setup = computeSetupStatus(unitRows, configRows)
  const unitsWithoutWhatsApp = unitRows.filter((u) => u.is_active && !u.whatsapp_phone)

  // Leads por dia (7 dias)
  const dayBuckets = new Map<string, number>()
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(sevenDaysAgo.getTime() + i * 24 * 60 * 60 * 1000)
    dayBuckets.set(toDateKey(day), 0)
  }
  for (const lead of (recentLeads as { created_at: string }[] | null) ?? []) {
    const key = toDateKey(new Date(lead.created_at))
    if (dayBuckets.has(key)) dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + 1)
  }
  const leadsByDay = Array.from(dayBuckets.entries()).map(([date, count]) => ({ date, count }))

  const sdrConfig = configRows.find((c) => c.agent_type === 'sdr')
  const whatsappConnected = unitRows.some((u) => u.whatsapp_phone)
  const sdrActive = !!sdrConfig?.is_active && whatsappConnected
  const sdrStateLabel = sdrActive
    ? 'Trabalhando'
    : sdrConfig?.is_active
      ? 'Falta conectar o WhatsApp'
      : sdrConfig
        ? 'Configurado — falta ligar'
        : 'Não configurado'

  const kpis = [
    { label: 'Novos contatos (24h)', value: newLeads24h ?? 0, sub: 'pessoas que chegaram até você', icon: ArrowUpRight, href: '/dashboard/leads', grad: 'from-emerald-400 to-green-500' },
    { label: 'Conversas hoje', value: conversationsToday ?? 0, sub: 'mensagens trocadas', icon: MessageSquare, href: '/dashboard/conversations', grad: 'from-sky-400 to-blue-400' },
    { label: 'Negócios fechados', value: wonLeads ?? 0, sub: 'desde o início', icon: CheckCircle2, href: '/dashboard/crm', grad: 'from-green-500 to-teal-500' },
    { label: 'Contatos no total', value: totalLeads ?? 0, sub: 'na sua base', icon: Users, href: '/dashboard/leads', grad: 'from-violet-400 to-purple-500' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Visão geral</p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-white">{greeting(now)}, {firstName}! 👋</h1>
          <p className="mt-0.5 text-sm" style={{ color: 'rgba(148,163,184,0.7)' }}>
            {setup.complete
              ? 'Seu funcionário digital está trabalhando por você.'
              : 'Falta pouco pra colocar seu funcionário digital pra trabalhar.'}
          </p>
        </div>
      </div>

      {/* Próxima ação — só aparece enquanto o setup não terminou */}
      {!setup.complete && setup.nextAction && (
        <div
          className="overflow-hidden rounded-2xl"
          style={{
            background: 'linear-gradient(135deg, rgba(6,182,212,0.12) 0%, rgba(67,97,238,0.08) 100%)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(6,182,212,0.25)',
          }}
        >
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 4px 14px rgba(6,182,212,0.35)' }}>
                <Rocket size={20} className="text-white" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">o que fazer agora</p>
                <h2 className="mt-0.5 text-lg font-black text-white">{setup.nextAction.label}</h2>
                <p className="mt-0.5 text-sm text-slate-300">{setup.nextAction.description}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {setup.steps.map((s) => (
                    <span
                      key={s.id}
                      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
                      style={s.done ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80' } : { background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}
                    >
                      {s.done && <Check size={10} />}
                      {s.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <Link
              href={setup.nextAction.href}
              className="flex flex-shrink-0 items-center gap-2 rounded-xl px-6 py-3 text-sm font-black text-white transition-all hover:scale-[1.02]"
              style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 4px 14px rgba(6,182,212,0.35)' }}
            >
              Continuar configuração
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}

      {/* KPIs — linguagem de dono de negócio */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(({ label, value, sub, icon: Icon, href, grad }) => (
          <Link
            key={label}
            href={href}
            className="group relative overflow-hidden rounded-2xl transition-all duration-200 hover:-translate-y-0.5"
            style={{ background: '#141a2b', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
          >
            <div className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${grad}`} />
            <div className="p-4 pt-5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${grad}`} style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
                <Icon size={16} className="text-white" />
              </div>
              <p className="mt-3 text-[30px] font-black leading-none tracking-tight text-white">{value}</p>
              <p className="mt-1.5 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">{label}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Funcionários digitais — estado de cada um */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Seus funcionários digitais</p>
          <Link href="/dashboard/equipe-digital" className="text-[11px] font-semibold" style={{ color: '#06b6d4' }}>
            Contratar & ativar funcionários →
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <EmployeeCard
            icon={Bot}
            name={sdrConfig?.persona_name ? `${sdrConfig.persona_name} · AI Sales Representative` : 'AI Sales Representative'}
            desc="Atende seus clientes no WhatsApp, responde dúvidas e agenda conversas."
            state={sdrActive ? 'active' : sdrConfig ? 'partial' : 'off'}
            stateLabel={sdrStateLabel}
            href={sdrActive ? '/dashboard/agents' : '/dashboard/onboarding'}
            cta={sdrActive ? 'Ver detalhes' : 'Configurar'}
          />
          <EmployeeCard
            icon={Briefcase}
            name="Recrutador (RH)"
            desc="Divulga vagas, faz triagem de candidatos e entrega os melhores pra você."
            state={(openJobs ?? 0) > 0 ? 'active' : 'off'}
            stateLabel={(openJobs ?? 0) > 0 ? `${openJobs} vaga(s) em andamento` : 'Nenhuma vaga aberta'}
            href={(openJobs ?? 0) > 0 ? '/dashboard/recruiter' : '/dashboard/equipe-digital'}
            cta={(openJobs ?? 0) > 0 ? 'Acompanhar vagas' : 'Ativar e configurar'}
          />
          <EmployeeCard
            icon={Megaphone}
            name="Tráfego pago"
            desc="Cuida dos seus anúncios no Instagram/Facebook e Google, otimizando o investimento."
            state={(adAccounts ?? 0) > 0 ? 'active' : 'off'}
            stateLabel={(adAccounts ?? 0) > 0 ? `${adAccounts} conta(s) de anúncio` : 'Contas não conectadas'}
            href={(adAccounts ?? 0) > 0 ? '/dashboard/traffic' : '/dashboard/equipe-digital'}
            cta={(adAccounts ?? 0) > 0 ? 'Ver desempenho' : 'Ativar e configurar'}
          />
        </div>
      </div>

      {/* Gráfico + WhatsApp */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="col-span-2 rounded-2xl p-5" style={{ background: '#141a2b', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}>
          <div className="mb-4">
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">tendência</p>
            <h2 className="text-sm font-bold text-white">Novos contatos por dia — últimos 7 dias</h2>
          </div>
          <LeadsByDayChart counts={leadsByDay} />
        </div>

        <div className="rounded-2xl p-5" style={{ background: '#141a2b', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">conexão</p>
              <h2 className="text-sm font-bold text-white">WhatsApp</h2>
            </div>
            <Link href="/dashboard/units" className="rounded-lg px-2.5 py-1 text-[11px] font-semibold" style={{ color: '#06b6d4' }}>
              Ver tudo →
            </Link>
          </div>
          <div className="space-y-2.5">
            {unitRows.slice(0, 4).map((unit) => (
              <div key={unit.id} className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div className="min-w-0">
                  <Link href={`/dashboard/units/${unit.id}`} className="block truncate text-sm font-semibold text-white hover:text-cyan-400">
                    {unit.name}
                  </Link>
                </div>
                {unit.whatsapp_phone ? (
                  <span className="flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}>
                    <CheckCircle2 size={10} /> Conectado
                  </span>
                ) : (
                  <Link href="/dashboard/onboarding" className="flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}>
                    <WifiOff size={10} /> Conectar
                  </Link>
                )}
              </div>
            ))}
            {unitRows.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-500">Nenhuma unidade ainda.</p>
            )}
            {unitsWithoutWhatsApp.length > 0 && (
              <p className="text-[11px] text-slate-500">
                Sem WhatsApp conectado o funcionário digital não consegue atender.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Saúde das integrações (com linguagem simples no componente) */}
      <IntegrationsStatusCard isSuperAdmin={false} />
    </div>
  )
}

function EmployeeCard({
  icon: Icon,
  name,
  desc,
  state,
  stateLabel,
  href,
  cta,
}: {
  icon: typeof Bot
  name: string
  desc: string
  state: 'active' | 'partial' | 'off'
  stateLabel: string
  href: string
  cta: string
}) {
  const stateStyle =
    state === 'active'
      ? { background: 'rgba(34,197,94,0.12)', color: '#4ade80' }
      : state === 'partial'
        ? { background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }
        : { background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 4px 10px rgba(6,182,212,0.25)' }}>
          <Icon size={16} className="text-white" />
        </div>
        <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold" style={stateStyle}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
          {stateLabel}
        </span>
      </div>
      <div className="flex-1">
        <p className="text-sm font-bold text-white">{name}</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{desc}</p>
      </div>
      <Link
        href={href}
        className="flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold text-slate-200 transition-all hover:bg-white/5"
        style={{ border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {cta}
        <ArrowRight size={11} />
      </Link>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Visão do TIME ALIZO (super admin) — saúde de todos os clientes.
// ─────────────────────────────────────────────────────────────────────────────

async function AdminHome({ firstName }: { firstName: string }) {
  const supabase = await createClient()
  const now = new Date()

  const [{ data: orgs }, { data: units }, { data: configs }, { data: summary }, { data: financial }] = await Promise.all([
    supabase.from('organizations').select('*').order('created_at', { ascending: false }),
    supabase.from('units').select('id, org_id, name, whatsapp_phone, is_active'),
    supabase.from('agent_configs').select('unit_id, agent_type, is_active, persona_name'),
    supabase.from('dashboard_summary').select('*'),
    supabase.from('financial_records').select('type, amount, status'),
  ])

  const orgRows = (orgs ?? []) as Organization[]
  const unitRows = (units ?? []) as Pick<Unit, 'id' | 'org_id' | 'name' | 'whatsapp_phone' | 'is_active'>[]
  const configRows = (configs ?? []) as Pick<AgentConfig, 'unit_id' | 'agent_type' | 'is_active' | 'persona_name'>[]
  const summaryRows = (summary ?? []) as DashboardSummaryRow[]
  const financialRows = (financial ?? []) as { type: string; amount: number; status: string }[]

  const unitsByOrg = new Map<string, typeof unitRows>()
  for (const u of unitRows) {
    if (!u.org_id) continue
    unitsByOrg.set(u.org_id, [...(unitsByOrg.get(u.org_id) ?? []), u])
  }
  const configsByUnit = new Map<string, typeof configRows>()
  for (const c of configRows) {
    configsByUnit.set(c.unit_id, [...(configsByUnit.get(c.unit_id) ?? []), c])
  }
  const leadsByUnit = new Map(summaryRows.map((r) => [r.unit_id, r]))

  const orgHealth = orgRows.map((org) => {
    const orgUnits = unitsByOrg.get(org.id) ?? []
    const orgConfigs = orgUnits.flatMap((u) => configsByUnit.get(u.id) ?? [])
    const setup = computeSetupStatus(orgUnits, orgConfigs)
    const totalLeads = orgUnits.reduce((s, u) => s + Number(leadsByUnit.get(u.id)?.total_leads ?? 0), 0)
    return { org, setup, unitCount: orgUnits.length, whatsappCount: orgUnits.filter((u) => u.whatsapp_phone).length, totalLeads }
  })

  const activeOrgs = orgHealth.filter((o) => o.org.is_active)
  const stuckOrgs = activeOrgs.filter((o) => !o.setup.complete)
  const noWhatsApp = activeOrgs.filter((o) => o.whatsappCount === 0)
  const mrrPaid = financialRows.filter((r) => r.type === 'receivable' && r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0)
  const mrrPending = financialRows.filter((r) => r.type === 'receivable' && r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0)

  const kpis = [
    { label: 'Clientes ativos', value: String(activeOrgs.length), sub: `${orgRows.length} no total`, grad: 'from-cyan-400 to-blue-500' },
    { label: 'Setup incompleto', value: String(stuckOrgs.length), sub: 'clientes que não terminaram', grad: 'from-amber-400 to-orange-500' },
    { label: 'Sem WhatsApp', value: String(noWhatsApp.length), sub: 'clientes sem conexão', grad: 'from-red-400 to-rose-500' },
    { label: 'Recebido', value: `R$ ${mrrPaid.toLocaleString('pt-BR')}`, sub: `R$ ${mrrPending.toLocaleString('pt-BR')} pendente`, grad: 'from-emerald-400 to-green-500' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Operação Alizo · visão interna</p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-white">{greeting(now)}, {firstName}! 👋</h1>
          <p className="mt-0.5 text-sm" style={{ color: 'rgba(148,163,184,0.7)' }}>
            Saúde de todos os clientes da plataforma num lugar só.
          </p>
        </div>
        <PrimaryButton href="/dashboard/organizations/new" icon={<Building2 size={14} />}>
          Novo cliente
        </PrimaryButton>
      </div>

      {/* KPIs internos */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(({ label, value, sub, grad }) => (
          <div key={label} className="relative overflow-hidden rounded-2xl" style={{ background: '#141a2b', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}>
            <div className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${grad}`} />
            <div className="p-4 pt-5">
              <p className="text-[26px] font-black leading-none tracking-tight text-white">{value}</p>
              <p className="mt-1.5 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">{label}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Clientes que precisam de atenção */}
      {stuckOrgs.length > 0 && (
        <Card className="p-5">
          <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">precisam de atenção</p>
          <h2 className="text-sm font-bold text-white">Clientes com configuração parada</h2>
          <div className="mt-3 space-y-2">
            {stuckOrgs.slice(0, 6).map(({ org, setup }) => (
              <Link
                key={org.id}
                href={`/dashboard/organizations/${org.id}`}
                className="flex items-center justify-between rounded-xl px-4 py-3 transition-colors hover:bg-white/[0.04]"
                style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)' }}
              >
                <div>
                  <p className="text-sm font-semibold text-white">{org.name}</p>
                  <p className="text-[11px] text-slate-400">
                    Parado em: <span className="font-semibold text-amber-400">{setup.nextAction?.label ?? '—'}</span>
                  </p>
                </div>
                <span className="text-xs font-bold text-amber-400">{setup.progress}% →</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Tabela de clientes */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">todos os clientes</p>
            <h2 className="text-sm font-bold text-white">Saúde por cliente</h2>
          </div>
          <Link href="/dashboard/organizations" className="rounded-lg px-2.5 py-1 text-[11px] font-semibold" style={{ color: '#06b6d4' }}>
            Ver página completa →
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              {['Cliente', 'Plano', 'Setup', 'WhatsApp', 'Leads', 'Status'].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orgHealth.map(({ org, setup, unitCount, whatsappCount, totalLeads }) => (
              <tr key={org.id} className="last:border-0 transition-colors hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td className="px-5 py-3.5">
                  <Link href={`/dashboard/organizations/${org.id}`} className="font-semibold text-white transition-colors hover:text-cyan-400">
                    {org.name}
                  </Link>
                  <p className="text-[11px] text-slate-500">{org.owner_email ?? '—'}</p>
                </td>
                <td className="px-5 py-3.5"><Badge variant="purple">{org.plan}</Badge></td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                      <div className="h-full rounded-full" style={{ width: `${setup.progress}%`, background: setup.complete ? '#4ade80' : 'linear-gradient(90deg,#06b6d4,#4361ee)' }} />
                    </div>
                    <span className="text-[11px] font-bold text-slate-400">{setup.progress}%</span>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <Badge variant={whatsappCount > 0 ? 'green' : 'amber'}>
                    {whatsappCount}/{unitCount}
                  </Badge>
                </td>
                <td className="px-5 py-3.5 font-medium text-slate-400">{totalLeads}</td>
                <td className="px-5 py-3.5">
                  <Badge variant={org.is_active ? 'green' : 'slate'}>{org.is_active ? 'Ativa' : 'Inativa'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Saúde das integrações da plataforma */}
      <IntegrationsStatusCard isSuperAdmin />
    </div>
  )
}
