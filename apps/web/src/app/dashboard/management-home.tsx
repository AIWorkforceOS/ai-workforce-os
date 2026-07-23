// Home do modo GESTÃO COMPLETA (organizations.management_mode =
// 'full_management'): o painel abre como sistema de gestão de empresa de
// serviços — clientes ativos, serviços da semana, financeiro e clientes
// captados direto na tela inicial. Módulo colocado (não é rota), mesmo
// padrão de home-views.tsx; a page.tsx despacha pra cá pelo modo da org.
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { computeSetupStatus } from '@/lib/setup-status'
import { unitDefaultLocale } from '@/lib/i18n/config'
import {
  AlertBanner,
  Card,
  KpiCard,
  SectionLabel,
  StatusPill,
  TableCard,
  TableShell,
  Td,
  Th,
  Tr,
  type BadgeVariant,
} from '@/components/ui/dashboard-ui'
import {
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardList,
  MapPin,
  Rocket,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import { RECURRENCE_PILL_LABEL, type RecurrenceType } from '@/lib/scheduling/recurrence'
import type { AgentConfig, AppointmentStatus, Unit } from '@/lib/types'

function startOfDay(date: Date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(now),
  )
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

// Restringe uma query à unidade do dono, quando houver (mesma receita de home-views).
function scopedToUnit<Q>(query: Q, unitId: string | null): Q {
  if (!unitId) return query
  return (query as { eq(column: string, value: string): unknown }).eq('unit_id', unitId) as Q
}

type UpcomingAppointment = {
  id: string
  unit_id: string
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  address: string | null
  recurrence: RecurrenceType | null
  custom_fields: Record<string, unknown> | null
  customer: { name: string } | null
  service: { name: string; price: number | null } | null
  employee: { name: string } | null
}

type ServiceRecordRow = {
  amount_charged: number | null
  amount_due: number | null
  payment_status: 'pending' | 'paid'
}

const STATUS_VARIANT: Record<AppointmentStatus, BadgeVariant> = {
  scheduled: 'cyan',
  confirmed: 'blue',
  completed: 'green',
  cancelled: 'slate',
  no_show: 'red',
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Faltou',
}

/** Valor combinado do atendimento: custom_fields.price sobrepõe o preço do serviço. */
function appointmentPrice(a: UpcomingAppointment): number | null {
  const custom = Number((a.custom_fields as { price?: unknown } | null)?.price)
  if (Number.isFinite(custom) && custom > 0) return custom
  return a.service?.price ?? null
}

export async function ManagementHome({ firstName, unitId }: { firstName: string; unitId: string | null }) {
  const supabase = await createClient()
  const now = new Date()
  const todayStart = startOfDay(now)
  const sevenDaysAgo = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000))
  const sevenDaysAhead = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000)

  const [
    { data: units },
    { data: agentConfigs },
    { count: activeCustomers },
    { count: newCustomers7d },
    { data: upcoming },
    { data: recordsWeek },
    { data: pendingPayRecords },
    { data: sentInvoices },
  ] = await Promise.all([
    supabase.from('units').select('*').order('created_at', { ascending: true }),
    supabase.from('agent_configs').select('*'),
    scopedToUnit(
      supabase.from('customers').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      unitId,
    ),
    scopedToUnit(
      supabase.from('customers').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo.toISOString()),
      unitId,
    ),
    scopedToUnit(
      supabase
        .from('appointments')
        .select(
          'id, unit_id, starts_at, ends_at, status, address, recurrence, custom_fields, customer:customers(name), service:services(name, price), employee:employees(name)',
        )
        .in('status', ['scheduled', 'confirmed'])
        .gte('starts_at', todayStart.toISOString())
        .lt('starts_at', sevenDaysAhead.toISOString())
        .order('starts_at')
        .limit(50),
      unitId,
    ),
    scopedToUnit(
      supabase
        .from('service_records')
        .select('amount_charged, amount_due, payment_status')
        .gte('service_date', sevenDaysAgo.toISOString().slice(0, 10)),
      unitId,
    ),
    scopedToUnit(
      supabase.from('service_records').select('amount_charged, amount_due, payment_status').eq('payment_status', 'pending'),
      unitId,
    ),
    scopedToUnit(supabase.from('invoices').select('amount').eq('status', 'sent'), unitId),
  ])

  const allUnits = (units ?? []) as Unit[]
  const allConfigs = (agentConfigs ?? []) as AgentConfig[]
  const unitRows = unitId ? allUnits.filter((u) => u.id === unitId) : allUnits
  const configRows = unitId ? allConfigs.filter((c) => c.unit_id === unitId) : allConfigs
  const ownUnit = unitId ? unitRows[0] : undefined
  const setup = computeSetupStatus(unitRows, configRows)

  const upcomingRows = ((upcoming ?? []) as unknown as UpcomingAppointment[])
  const weekRecords = ((recordsWeek ?? []) as ServiceRecordRow[])
  const pendingRecords = ((pendingPayRecords ?? []) as ServiceRecordRow[])
  const invoiceRows = ((sentInvoices ?? []) as { amount: number }[])

  // Moeda pela unidade (mesma receita da tela de Operação): dono de unidade
  // usa a própria; org multi-unidade usa a primeira — valores são agregados.
  const currencyUnit = ownUnit ?? unitRows[0]
  const currency = currencyUnit && unitDefaultLocale(currencyUnit) === 'en' ? 'USD' : 'BRL'
  const intlLocale = currency === 'USD' ? 'en-US' : 'pt-BR'
  const money = (value: number | null) =>
    value === null ? '—' : value.toLocaleString(intlLocale, { style: 'currency', currency })

  const billedWeek = weekRecords.reduce((s, r) => s + Number(r.amount_charged ?? 0), 0)
  const teamPayPending = pendingRecords.reduce((s, r) => s + Number(r.amount_due ?? 0), 0)
  const invoicesOutstanding = invoiceRows.reduce((s, r) => s + Number(r.amount), 0)
  const expectedWeek = upcomingRows.reduce((s, a) => s + (appointmentPrice(a) ?? 0), 0)

  const unitNameById = new Map(allUnits.map((u) => [u.id, u.name]))
  const timezoneByUnit = new Map(allUnits.map((u) => [u.id, u.timezone]))

  const agendaHref = unitId ? `/dashboard/units/${unitId}/agenda/calendario` : '/dashboard/agenda'
  const operacaoHref = unitId ? `/dashboard/units/${unitId}/operacao` : '/dashboard/operacao'

  const kpis = [
    { label: 'Clientes ativos', value: activeCustomers ?? 0, sub: 'no seu cadastro', icon: Users, href: '/dashboard/receptionist/customers', grad: 'from-cyan-400 to-blue-500' },
    { label: 'Serviços (próx. 7 dias)', value: upcomingRows.length, sub: 'agendados na semana', icon: CalendarDays, href: agendaHref, grad: 'from-violet-400 to-purple-500' },
    { label: 'Faturado (7 dias)', value: money(billedWeek), sub: 'serviços concluídos', icon: Wallet, href: operacaoHref, grad: 'from-emerald-400 to-green-500' },
    { label: 'Clientes novos (7 dias)', value: newCustomers7d ?? 0, sub: 'captados na semana', icon: UserPlus, href: '/dashboard/receptionist/customers', grad: 'from-amber-400 to-orange-500' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">
            {unitId ? `Minha unidade${ownUnit ? ` · ${ownUnit.name}` : ''}` : 'Gestão da sua empresa'}
          </p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-white">{greeting(now)}, {firstName}! 👋</h1>
          <p className="mt-0.5 text-sm" style={{ color: 'rgba(148,163,184,0.7)' }}>
            Clientes, serviços da semana e financeiro num lugar só.
          </p>
        </div>
      </div>

      {/* Próxima ação de setup — some quando terminar */}
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

      {/* KPIs de gestão */}
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

      {/* Serviços da semana */}
      <TableCard
        eyebrow="agenda"
        title="Serviços da semana"
        action={
          <Link href={agendaHref} className="rounded-lg px-2.5 py-1 text-[11px] font-semibold" style={{ color: '#06b6d4' }}>
            Abrir agenda →
          </Link>
        }
      >
        {upcomingRows.length === 0 ? (
          <tbody>
            <tr>
              <td className="px-5 py-6 text-sm text-slate-500">
                Nenhum serviço agendado pros próximos 7 dias.{' '}
                <Link href={agendaHref} className="font-bold text-cyan-400 hover:underline">Agendar agora →</Link>
              </td>
            </tr>
          </tbody>
        ) : (
          <>
            <TableShell>
              <Th>Quando</Th>
              <Th>Cliente</Th>
              <Th>Serviço</Th>
              <Th>Profissional</Th>
              <Th>Valor</Th>
              <Th>Status</Th>
            </TableShell>
            <tbody>
              {upcomingRows.slice(0, 8).map((a) => {
                const tz = timezoneByUnit.get(a.unit_id) ?? 'America/Sao_Paulo'
                const price = appointmentPrice(a)
                return (
                  <Tr key={a.id}>
                    <Td>
                      <Link href={`/dashboard/units/${a.unit_id}/agenda/calendario`} className="font-semibold text-white transition-colors hover:text-cyan-400">
                        {new Date(a.starts_at).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: tz })}
                        {' · '}
                        {new Date(a.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz })}
                      </Link>
                      {!unitId && <p className="text-[11px] text-slate-500">{unitNameById.get(a.unit_id) ?? ''}</p>}
                    </Td>
                    <Td className="font-medium text-slate-300">
                      {a.customer?.name ?? '—'}
                      {a.address && (
                        <p className="flex items-center gap-1 text-[11px] text-slate-500">
                          <MapPin size={10} />
                          {a.address}
                        </p>
                      )}
                    </Td>
                    <Td className="text-slate-400">
                      {a.service?.name ?? '—'}
                      {a.recurrence && (
                        <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(129,140,248,0.15)', color: '#a5b4fc' }}>
                          {RECURRENCE_PILL_LABEL[a.recurrence]}
                        </span>
                      )}
                    </Td>
                    <Td className="text-slate-400">{a.employee?.name ?? '—'}</Td>
                    <Td className="font-medium text-slate-300">{money(price)}</Td>
                    <Td>
                      <StatusPill variant={STATUS_VARIANT[a.status]}>{STATUS_LABEL[a.status]}</StatusPill>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </>
        )}
      </TableCard>

      {/* Financeiro — alimentado automaticamente pela agenda e pela operação */}
      <div>
        <SectionLabel
          className="mb-3"
          action={
            <Link href={operacaoHref} className="text-[11px] font-semibold" style={{ color: '#06b6d4' }}>
              Ver operação e faturas →
            </Link>
          }
        >
          Financeiro
        </SectionLabel>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Realizado (7 dias)" value={money(billedWeek)} sub="serviços concluídos" href={operacaoHref} gradient="from-emerald-400 to-green-500" icon={<Wallet size={16} className="text-white" />} />
          <KpiCard label="Previsto (próx. 7 dias)" value={money(expectedWeek)} sub="agendamentos da semana" href={agendaHref} gradient="from-sky-400 to-blue-400" icon={<CalendarDays size={16} className="text-white" />} />
          <KpiCard label="A pagar à equipe" value={money(teamPayPending)} sub="serviços pendentes de pagamento" href={operacaoHref} gradient="from-amber-400 to-orange-500" icon={<Users size={16} className="text-white" />} />
          <KpiCard label="Faturas aguardando" value={money(invoicesOutstanding)} sub="enviadas e ainda não pagas" href={operacaoHref} gradient="from-violet-400 to-purple-500" icon={<ClipboardList size={16} className="text-white" />} />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Agendou um serviço? Ele já entra na agenda e no previsto. Concluiu na agenda? Já vira faturamento e valor a pagar — sem lançamento manual.
        </p>
      </div>

      {/* Atalhos + funcionários digitais continuam disponíveis */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { href: '/dashboard/receptionist/customers/new', icon: UserPlus, label: 'Cadastrar cliente', desc: 'nome, contato, serviço e valor' },
          { href: agendaHref, icon: CalendarDays, label: 'Agendar serviço', desc: 'único ou toda semana no mesmo horário' },
          { href: '/dashboard/equipe-digital', icon: Rocket, label: 'Funcionários digitais', desc: 'atendimento, vendas, RH e tráfego' },
        ].map(({ href, icon: Icon, label, desc }) => (
          <Link key={href} href={href}>
            <Card className="flex items-center gap-3 p-4 transition-all hover:scale-[1.01]">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)' }}>
                <Icon size={16} className="text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">{label}</p>
                <p className="truncate text-[11px] text-slate-500">{desc}</p>
              </div>
              <ArrowRight size={14} className="ml-auto flex-shrink-0 text-slate-500" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
