import { Headset, TrendingUp, UserPlus, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Badge, type BadgeVariant, Card, EmptyState, PageHeader, PrimaryButton } from '@/components/ui/dashboard-ui'
import type { Customer } from '@/lib/types'
import { getAppUser } from '@/lib/app-user'
import { fetchOrganizationVerticalKey } from '@/lib/organizations'
import { getCustomerTerm } from '@/lib/verticals/terminology'
import { VERTICAL_TEMPLATES, type VerticalKey } from '@/lib/verticals/catalog'

export const dynamic = 'force-dynamic'

// Dashboard operacional do AI Receptionist (Fase 1): só indicadores
// reais do que já existe nesta fase (cadastro de clientes). Sem
// agenda/OS/financeiro — esses módulos ainda não existem, então não
// há métrica honesta pra mostrar sobre eles ainda.

const STATUS_LABEL: Record<string, string> = { active: 'Ativo', inactive: 'Inativo' }
const STATUS_VARIANT: Record<string, BadgeVariant> = { active: 'green', inactive: 'slate' }

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

type VerticalKpiRow = Pick<Customer, 'status' | 'custom_fields'>

/**
 * KPIs do catálogo (lib/verticals/catalog.ts dashboardKpis) — só os que
 * dá pra computar de verdade com o que existe hoje (customers/custom_fields).
 * Os demais (ex.: "jobs_this_month", "avg_ticket", "sessions_this_month")
 * dependem de agenda/financeiro, que ainda não existem, então ficam de
 * fora aqui em vez de mostrar um número inventado — a seção genérica
 * (total/novos-na-semana/status) cobre esse caso.
 */
function computeVerticalKpis(
  verticalKey: VerticalKey | null,
  rows: VerticalKpiRow[],
): { key: string; label: string; value: number }[] {
  if (!verticalKey) return []
  const template = VERTICAL_TEMPLATES[verticalKey]
  const computed: Record<string, number> = {}

  if (verticalKey === 'cleaning_services') {
    computed.active_recurring_customers = rows.filter((c) => {
      if (c.status !== 'active') return false
      const freq = (c.custom_fields as Record<string, unknown> | null)?.cleaning_frequency
      return typeof freq === 'string' && freq.trim().length > 0 && freq !== 'avulsa'
    }).length
  }

  if (verticalKey === 'therapy_clinic') {
    computed.active_patients = rows.filter((c) => c.status === 'active').length
    computed.waitlist_size = rows.filter(
      (c) => (c.custom_fields as Record<string, unknown> | null)?.on_waitlist === true,
    ).length
  }

  return template.dashboardKpis
    .filter((kpi) => kpi.key in computed)
    .map((kpi) => ({ key: kpi.key, label: kpi.labelPt, value: computed[kpi.key]! }))
}

export default async function ReceptionistHomePage() {
  const supabase = await createClient()
  const appUser = await getAppUser()
  const verticalKey = await fetchOrganizationVerticalKey(supabase, appUser?.orgId)
  const term = getCustomerTerm(verticalKey, 'pt')
  const termPlural = getCustomerTerm(verticalKey, 'pt', { plural: true })

  const { data: customers } = await supabase
    .from('customers')
    .select('id, status, source, tags, created_at, custom_fields')

  const rows = (customers ?? []) as Pick<
    Customer,
    'id' | 'status' | 'source' | 'tags' | 'created_at' | 'custom_fields'
  >[]

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="ai receptionist" title="AI Receptionist" subtitle={`Organiza o atendimento e mantém o cadastro de ${termPlural.toLowerCase()} em dia.`} />
        <Card>
          <EmptyState
            icon={<Headset size={22} className="text-white" />}
            title={`Nenhum ${term.toLowerCase()} cadastrado ainda`}
            subtitle={`${termPlural} aparecem aqui assim que o Sales Rep fechar um negócio, ou você pode cadastrar um manualmente.`}
            actionHref="/dashboard/receptionist/customers/new"
            actionLabel={`Cadastrar ${term.toLowerCase()}`}
          />
        </Card>
      </div>
    )
  }

  const weekAgo = daysAgo(7)
  const newThisWeek = rows.filter((c) => new Date(c.created_at) >= weekAgo).length

  const byStatus = new Map<string, number>()
  const bySource = new Map<string, number>()
  const byTag = new Map<string, number>()
  for (const c of rows) {
    byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1)
    bySource.set(c.source, (bySource.get(c.source) ?? 0) + 1)
    for (const tag of c.tags ?? []) byTag.set(tag, (byTag.get(tag) ?? 0) + 1)
  }

  const kpis = [
    { label: `Total de ${termPlural.toLowerCase()}`, value: rows.length, sub: 'na base', icon: Users, grad: 'from-cyan-400 to-blue-500' },
    { label: 'Novos na semana', value: newThisWeek, sub: 'últimos 7 dias', icon: UserPlus, grad: 'from-emerald-400 to-green-500' },
    { label: 'Ativos', value: byStatus.get('active') ?? 0, sub: 'status ativo', icon: TrendingUp, grad: 'from-violet-400 to-purple-500' },
  ]

  const verticalKpis = computeVerticalKpis(verticalKey, rows)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="ai receptionist"
        title="AI Receptionist"
        subtitle={`Organiza o atendimento e mantém o cadastro de ${termPlural.toLowerCase()} em dia.`}
        action={<PrimaryButton href="/dashboard/receptionist/customers/new" icon={<UserPlus size={14} />}>Novo {term.toLowerCase()}</PrimaryButton>}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {kpis.map(({ label, value, sub, icon: Icon, grad }) => (
          <div
            key={label}
            className="relative overflow-hidden rounded-2xl"
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
          </div>
        ))}
      </div>

      {verticalKpis.length > 0 && (
        <Card className="p-5">
          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">
            Indicadores — {VERTICAL_TEMPLATES[verticalKey!].labelPt}
          </p>
          <div className="flex flex-wrap gap-2">
            {verticalKpis.map((kpi) => (
              <Badge key={kpi.key} variant="cyan">
                {kpi.label} · {kpi.value}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Por status</p>
          <div className="flex flex-wrap gap-2">
            {[...byStatus.entries()].map(([status, count]) => (
              <Badge key={status} variant={STATUS_VARIANT[status] ?? 'slate'}>
                {STATUS_LABEL[status] ?? status} · {count}
              </Badge>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Por origem</p>
          <div className="flex flex-wrap gap-2">
            {[...bySource.entries()].map(([source, count]) => (
              <Badge key={source} variant={source === 'sales' ? 'cyan' : 'slate'}>
                {source === 'sales' ? 'AI Sales Rep' : source === 'manual' ? 'Manual' : source} · {count}
              </Badge>
            ))}
          </div>
        </Card>

        {byTag.size > 0 && (
          <Card className="p-5 lg:col-span-2">
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Tags mais usadas</p>
            <div className="flex flex-wrap gap-2">
              {[...byTag.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([tag, count]) => (
                  <Badge key={tag} variant="purple">{tag} · {count}</Badge>
                ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
