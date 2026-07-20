// As duas variantes da home do dashboard (cliente e super admin), num módulo
// colocado (não é rota) pra page.tsx ficar só com o despacho por papel.
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { computeSetupStatus } from '@/lib/setup-status'
import { daysAgo, startOfMonth } from '@/lib/admin-metrics'
import { LeadsByDayChart } from '@/components/dashboard/leads-by-day-chart'
import { IntegrationsStatusCard } from '@/components/dashboard/integrations-status'
import {
  AlertBanner,
  Badge,
  Card,
  KpiCard,
  PrimaryButton,
  SectionLabel,
  StatusPill,
  TableCard,
  TableShell,
  Td,
  Th,
  Tr,
} from '@/components/ui/dashboard-ui'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  Headset,
  Megaphone,
  MessageSquare,
  Rocket,
  Users,
  WifiOff,
} from 'lucide-react'
import type { AgentConfig, DashboardSummaryRow, Organization, Unit } from '@/lib/types'

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

function formatUsd(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Restringe uma query à unidade do dono, quando houver. O cast evita que o
// TS tente instanciar o tipo profundo do PostgrestFilterBuilder (TS2589);
// .eq retorna o próprio builder em runtime.
function scopedToUnit<Q>(query: Q, unitId: string | null): Q {
  if (!unitId) return query
  return (query as { eq(column: string, value: string): unknown }).eq('unit_id', unitId) as Q
}

// ─────────────────────────────────────────────────────────────────────────────
// Visão da EMPRESA CLIENTE — linguagem de dono de negócio, foco em
// "o que está acontecendo" e "o que fazer agora".
// Serve dois papéis: admin da org (visão multi-unidade + comparativo) e dono
// de unidade (mesma tela, dados e copy restritos à unidade dele).
// ─────────────────────────────────────────────────────────────────────────────

export async function ClientHome({ firstName, unitId }: { firstName: string; unitId: string | null }) {
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
    { count: customersCount },
    { data: summary },
  ] = await Promise.all([
    supabase.from('units').select('*').order('created_at', { ascending: true }),
    supabase.from('agent_configs').select('*'),
    scopedToUnit(supabase.from('leads').select('id', { count: 'exact', head: true }), unitId),
    scopedToUnit(
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', since24h.toISOString()),
      unitId,
    ),
    scopedToUnit(supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'won'), unitId),
    scopedToUnit(
      supabase.from('conversations').select('id', { count: 'exact', head: true }).gte('sent_at', todayStart.toISOString()),
      unitId,
    ),
    scopedToUnit(supabase.from('leads').select('created_at').gte('created_at', sevenDaysAgo.toISOString()), unitId),
    scopedToUnit(supabase.from('job_openings').select('id', { count: 'exact', head: true }), unitId),
    scopedToUnit(supabase.from('ad_accounts').select('id', { count: 'exact', head: true }), unitId),
    scopedToUnit(supabase.from('customers').select('id', { count: 'exact', head: true }), unitId),
    // Comparativo por unidade: só interessa na visão multi-unidade do admin.
    unitId ? Promise.resolve({ data: null }) : supabase.from('dashboard_summary').select('*'),
  ])

  const allUnits = (units ?? []) as Unit[]
  const allConfigs = (agentConfigs ?? []) as AgentConfig[]
  // Dono de unidade: tudo que aparece na tela fala só da unidade dele.
  const unitRows = unitId ? allUnits.filter((u) => u.id === unitId) : allUnits
  const configRows = unitId ? allConfigs.filter((c) => c.unit_id === unitId) : allConfigs
  const ownUnit = unitId ? unitRows[0] : undefined
  const setup = computeSetupStatus(unitRows, configRows)
  const unitsWithoutWhatsApp = unitRows.filter((u) => u.is_active && !u.whatsapp_phone)
  const summaryRows = ((summary ?? []) as DashboardSummaryRow[])
    .filter((r) => r.unit_id != null)
    .sort((a, b) => Number(b.total_leads) - Number(a.total_leads))

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
  const receptionistConfig = configRows.find((c) => c.agent_type === 'receptionist')
  const whatsappConnected = unitRows.some((u) => u.whatsapp_phone)
  const sdrActive = !!sdrConfig?.is_active && whatsappConnected
  const sdrStateLabel = sdrActive
    ? 'Trabalhando'
    : sdrConfig?.is_active
      ? 'Falta conectar o WhatsApp'
      : sdrConfig
        ? 'Configurado — falta ligar'
        : 'Não configurado'
  const receptionistActive = !!receptionistConfig?.is_active
  const receptionistStateLabel = receptionistActive
    ? (customersCount ?? 0) > 0
      ? `${customersCount} cliente(s) no cadastro`
      : 'Trabalhando'
    : receptionistConfig
      ? 'Configurado — falta ligar'
      : 'Não contratado'

  const scopeSuffix = unitId ? 'na sua unidade' : 'na sua base'
  const kpis = [
    { label: 'Novos contatos (24h)', value: newLeads24h ?? 0, sub: unitId ? 'chegaram na sua unidade' : 'pessoas que chegaram até você', icon: ArrowUpRight, href: '/dashboard/leads', grad: 'from-emerald-400 to-green-500' },
    { label: 'Conversas hoje', value: conversationsToday ?? 0, sub: 'mensagens trocadas', icon: MessageSquare, href: '/dashboard/conversations', grad: 'from-sky-400 to-blue-400' },
    { label: 'Negócios fechados', value: wonLeads ?? 0, sub: 'desde o início', icon: CheckCircle2, href: '/dashboard/crm', grad: 'from-green-500 to-teal-500' },
    { label: 'Contatos no total', value: totalLeads ?? 0, sub: scopeSuffix, icon: Users, href: '/dashboard/leads', grad: 'from-violet-400 to-purple-500' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">
            {unitId ? `Minha unidade${ownUnit ? ` · ${ownUnit.name}` : ''}` : 'Visão geral'}
          </p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-white">{greeting(now)}, {firstName}! 👋</h1>
          <p className="mt-0.5 text-sm" style={{ color: 'rgba(148,163,184,0.7)' }}>
            {setup.complete
              ? unitId
                ? 'O funcionário digital da sua unidade está trabalhando por você.'
                : 'Seu funcionário digital está trabalhando por você.'
              : unitId
                ? 'Falta pouco pra colocar o funcionário digital da sua unidade pra trabalhar.'
                : 'Falta pouco pra colocar seu funcionário digital pra trabalhar.'}
          </p>
        </div>
      </div>

      {/* Próxima ação — só aparece enquanto o setup não terminou */}
      {!setup.complete && setup.nextAction && (
        <AlertBanner
          icon={<Rocket size={20} className="text-white" />}
          eyebrow="o que fazer agora"
          title={setup.nextAction.label}
          description={setup.nextAction.description}
          action={
            <Link
              href={setup.nextAction.href}
              className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-black text-white transition-all hover:scale-[1.02]"
              style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 4px 14px rgba(6,182,212,0.35)' }}
            >
              Continuar configuração
              <ArrowRight size={14} />
            </Link>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
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
        </AlertBanner>
      )}

      {/* KPIs — linguagem de dono de negócio */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(({ label, value, sub, icon: Icon, href, grad }) => (
          <KpiCard
            key={label}
            label={label}
            value={value}
            sub={sub}
            href={href}
            gradient={grad}
            icon={<Icon size={16} className="text-white" />}
          />
        ))}
      </div>

      {/* Funcionários digitais — estado de cada um */}
      <div>
        <SectionLabel
          className="mb-3"
          action={
            <Link href="/dashboard/equipe-digital" className="text-[11px] font-semibold" style={{ color: '#06b6d4' }}>
              Contratar & ativar funcionários →
            </Link>
          }
        >
          {unitId ? 'Funcionários digitais da sua unidade' : 'Seus funcionários digitais'}
        </SectionLabel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
            icon={Headset}
            name={receptionistConfig?.persona_name ? `${receptionistConfig.persona_name} · AI Receptionist` : 'AI Receptionist'}
            desc="Recebe quem já é cliente, mantém o cadastro em dia e acompanha cada atendimento."
            state={receptionistActive ? 'active' : receptionistConfig ? 'partial' : 'off'}
            stateLabel={receptionistStateLabel}
            href={receptionistActive ? '/dashboard/receptionist' : '/dashboard/equipe-digital'}
            cta={receptionistActive ? 'Ver atendimento' : 'Ativar e configurar'}
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

      {/* Comparativo por unidade — só pro admin de org com mais de uma unidade */}
      {!unitId && allUnits.length > 1 && summaryRows.length > 0 && (
        <TableCard
          eyebrow="comparativo"
          title="Desempenho por unidade"
          action={
            <Link href="/dashboard/units" className="rounded-lg px-2.5 py-1 text-[11px] font-semibold" style={{ color: '#06b6d4' }}>
              Ver unidades →
            </Link>
          }
        >
          <TableShell>
            <Th>Unidade</Th>
            <Th>Contatos</Th>
            <Th>Novos</Th>
            <Th>Em conversa</Th>
            <Th>Fechados</Th>
            <Th>Conversas (24h)</Th>
          </TableShell>
          <tbody>
            {summaryRows.map((row) => (
              <Tr key={row.unit_id}>
                <Td>
                  <Link href={`/dashboard/units/${row.unit_id}`} className="font-semibold text-white transition-colors hover:text-cyan-400">
                    {row.unit_name}
                  </Link>
                  <p className="text-[11px] text-slate-500">
                    {[row.region_city, row.region_state].filter(Boolean).join(' · ') || '—'}
                  </p>
                </Td>
                <Td className="font-medium text-slate-300">{row.total_leads}</Td>
                <Td className="font-medium text-slate-400">{row.new_leads}</Td>
                <Td className="font-medium text-slate-400">{row.active_leads}</Td>
                <Td>
                  <span className="font-bold text-emerald-400">{row.won_leads}</span>
                </Td>
                <Td className="font-medium text-slate-400">{row.conversations_today}</Td>
              </Tr>
            ))}
          </tbody>
        </TableCard>
      )}

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
            {!unitId && (
              <Link href="/dashboard/units" className="rounded-lg px-2.5 py-1 text-[11px] font-semibold" style={{ color: '#06b6d4' }}>
                Ver tudo →
              </Link>
            )}
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

// Busca todas as páginas de uma query (PostgREST corta em ~1000 linhas por
// resposta). Retorna null se a PRIMEIRA página falhar (tabela ausente/sem
// permissão), pra tela distinguir "zero" de "sem dados". maxPages limita a
// latência; na escala atual nunca chega perto.
async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[] | null> {
  const pageSize = 1000
  const maxPages = 20
  const all: T[] = []
  for (let page = 0; page < maxPages; page += 1) {
    const { data, error } = await build(page * pageSize, (page + 1) * pageSize - 1)
    if (error || !data) return page === 0 ? null : all
    all.push(...data)
    if (data.length < pageSize) break
  }
  return all
}

export async function AdminHome({ firstName }: { firstName: string }) {
  const supabase = await createClient()
  const now = new Date()
  const monthStartIso = startOfMonth(now).toISOString()

  const [
    { data: orgs },
    { data: units },
    { data: configs },
    { data: summary },
    { data: financial },
    { data: errorEventsData },
    usageRows,
    recentConvoUnits,
  ] = await Promise.all([
    supabase.from('organizations').select('*').order('created_at', { ascending: false }),
    supabase.from('units').select('id, org_id, name, whatsapp_phone, is_active'),
    supabase.from('agent_configs').select('unit_id, agent_type, is_active, persona_name'),
    supabase.from('dashboard_summary').select('*'),
    supabase.from('financial_records').select('type, amount, status'),
    // Erros de integração das últimas 24h (system_events, gravados pelos crons/APIs)
    supabase
      .from('system_events')
      .select('org_id, source')
      .eq('level', 'error')
      .gte('created_at', daysAgo(1).toISOString())
      .order('created_at', { ascending: false })
      .limit(500),
    // Custo estimado de IA no mês corrente, por org (api_usage_events)
    fetchAllPages<{ org_id: string | null; provider: string; estimated_cost_usd: number }>((from, to) =>
      supabase
        .from('api_usage_events')
        .select('org_id, provider, estimated_cost_usd')
        .eq('provider', 'openai')
        .gte('created_at', monthStartIso)
        .order('created_at', { ascending: false })
        .range(from, to),
    ),
    // Unidades com pelo menos uma conversa nos últimos 7 dias → detecta cliente parado
    fetchAllPages<{ unit_id: string | null }>((from, to) =>
      supabase
        .from('conversations')
        .select('unit_id')
        .gte('sent_at', daysAgo(7).toISOString())
        .order('sent_at', { ascending: false })
        .range(from, to),
    ),
  ])

  const orgRows = (orgs ?? []) as Organization[]
  const unitRows = (units ?? []) as Pick<Unit, 'id' | 'org_id' | 'name' | 'whatsapp_phone' | 'is_active'>[]
  const configRows = (configs ?? []) as Pick<AgentConfig, 'unit_id' | 'agent_type' | 'is_active' | 'persona_name'>[]
  const summaryRows = (summary ?? []) as DashboardSummaryRow[]
  const financialRows = (financial ?? []) as { type: string; amount: number; status: string }[]
  const errorEvents = (errorEventsData ?? []) as { org_id: string | null; source: string }[]

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

  // Custo de IA (OpenAI) no mês, por org e total — null = migration 010 ausente
  const aiCostByOrg = new Map<string, number>()
  let aiCostTotal: number | null = null
  if (usageRows !== null) {
    aiCostTotal = 0
    for (const row of usageRows) {
      const cost = Number(row.estimated_cost_usd)
      aiCostTotal += cost
      if (row.org_id) aiCostByOrg.set(row.org_id, (aiCostByOrg.get(row.org_id) ?? 0) + cost)
    }
  }

  // Erros por origem e por org (24h)
  const errors24h = errorEvents.length
  const errorsBySource = new Map<string, number>()
  const errorsByOrg = new Map<string, number>()
  for (const e of errorEvents) {
    errorsBySource.set(e.source, (errorsBySource.get(e.source) ?? 0) + 1)
    if (e.org_id) errorsByOrg.set(e.org_id, (errorsByOrg.get(e.org_id) ?? 0) + 1)
  }
  const sourceSummary = Array.from(errorsBySource.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `${source} (${count})`)
    .join(' · ')
  const topErrorOrgId = Array.from(errorsByOrg.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
  const topErrorOrg = topErrorOrgId ? orgRows.find((o) => o.id === topErrorOrgId) : undefined

  // Unidades com conversa nos últimos 7 dias — null = falha na consulta
  const activeUnitIds = recentConvoUnits === null ? null : new Set(recentConvoUnits.map((r) => r.unit_id))

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
  const quietOrgs =
    activeUnitIds === null
      ? null
      : activeOrgs.filter((o) => !(unitsByOrg.get(o.org.id) ?? []).some((u) => activeUnitIds.has(u.id)))
  const mrrPaid = financialRows.filter((r) => r.type === 'receivable' && r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0)
  const mrrPending = financialRows.filter((r) => r.type === 'receivable' && r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0)

  const kpis = [
    { label: 'Clientes ativos', value: String(activeOrgs.length), sub: `${orgRows.length} no total`, grad: 'from-cyan-400 to-blue-500' },
    { label: 'Setup incompleto', value: String(stuckOrgs.length), sub: 'clientes que não terminaram', grad: 'from-amber-400 to-orange-500' },
    { label: 'Sem WhatsApp', value: String(noWhatsApp.length), sub: 'clientes sem conexão', grad: 'from-red-400 to-rose-500' },
    { label: 'Recebido', value: `R$ ${mrrPaid.toLocaleString('pt-BR')}`, sub: `R$ ${mrrPending.toLocaleString('pt-BR')} pendente`, grad: 'from-emerald-400 to-green-500' },
    {
      label: 'Erros (24h)',
      value: String(errors24h),
      sub: errors24h > 0 ? `principal origem: ${Array.from(errorsBySource.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]}` : 'nenhuma falha registrada',
      grad: 'from-rose-400 to-red-500',
    },
    {
      label: 'Custo de IA (mês)',
      value: aiCostTotal === null ? '—' : `US$ ${formatUsd(aiCostTotal)}`,
      sub: aiCostTotal === null ? 'sem dados de uso registrados' : 'estimado · OpenAI · mês corrente',
      grad: 'from-violet-400 to-purple-500',
    },
    {
      label: 'Sem conversas (7d)',
      value: quietOrgs === null ? '—' : String(quietOrgs.length),
      sub: quietOrgs === null ? 'sem dados de conversas' : 'clientes ativos sem nenhuma conversa',
      grad: 'from-sky-400 to-blue-400',
    },
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
          <KpiCard key={label} label={label} value={value} sub={sub} gradient={grad} />
        ))}
      </div>

      {/* Erros de integração nas últimas 24h */}
      {errors24h > 0 && (
        <AlertBanner
          tone="warning"
          icon={<AlertTriangle size={20} className="text-white" />}
          eyebrow="integrações"
          title={`${errors24h} erro${errors24h > 1 ? 's' : ''} de integração nas últimas 24h`}
          description={`Origens: ${sourceSummary}${topErrorOrg ? ` · cliente mais afetado: ${topErrorOrg.name}` : ''}`}
          action={
            topErrorOrg ? (
              <Link
                href={`/dashboard/organizations/${topErrorOrg.id}`}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-white/10"
                style={{ border: '1px solid rgba(255,255,255,0.15)' }}
              >
                Ver {topErrorOrg.name}
                <ArrowRight size={14} />
              </Link>
            ) : undefined
          }
        />
      )}

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
      <TableCard
        eyebrow="todos os clientes"
        title="Saúde por cliente"
        action={
          <Link href="/dashboard/organizations" className="rounded-lg px-2.5 py-1 text-[11px] font-semibold" style={{ color: '#06b6d4' }}>
            Ver página completa →
          </Link>
        }
      >
        <TableShell>
          <Th>Cliente</Th>
          <Th>Plano</Th>
          <Th>Setup</Th>
          <Th>WhatsApp</Th>
          <Th>Leads</Th>
          <Th>Custo IA (mês)</Th>
          <Th>Status</Th>
        </TableShell>
        <tbody>
          {orgHealth.map(({ org, setup, unitCount, whatsappCount, totalLeads }) => (
            <Tr key={org.id}>
              <Td>
                <Link href={`/dashboard/organizations/${org.id}`} className="font-semibold text-white transition-colors hover:text-cyan-400">
                  {org.name}
                </Link>
                <p className="text-[11px] text-slate-500">{org.owner_email ?? '—'}</p>
              </Td>
              <Td><Badge variant="purple">{org.plan}</Badge></Td>
              <Td>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full rounded-full" style={{ width: `${setup.progress}%`, background: setup.complete ? '#4ade80' : 'linear-gradient(90deg,#06b6d4,#4361ee)' }} />
                  </div>
                  <span className="text-[11px] font-bold text-slate-400">{setup.progress}%</span>
                </div>
              </Td>
              <Td>
                <Badge variant={whatsappCount > 0 ? 'green' : 'amber'}>
                  {whatsappCount}/{unitCount}
                </Badge>
              </Td>
              <Td className="font-medium text-slate-400">{totalLeads}</Td>
              <Td className="font-medium text-slate-400">
                {aiCostTotal === null ? '—' : `US$ ${formatUsd(aiCostByOrg.get(org.id) ?? 0)}`}
              </Td>
              <Td>
                <StatusPill variant={org.is_active ? 'green' : 'slate'}>{org.is_active ? 'Ativa' : 'Inativa'}</StatusPill>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableCard>

      {/* Saúde das integrações da plataforma */}
      <IntegrationsStatusCard isSuperAdmin />
    </div>
  )
}
