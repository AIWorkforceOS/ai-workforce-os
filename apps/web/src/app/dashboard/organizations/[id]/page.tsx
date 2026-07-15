import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { computeSetupStatus } from '@/lib/setup-status'
import { ProvisionUserForm, ResetPasswordButton, ToggleOrgActive } from '@/components/admin/org-actions'
import { Badge, Card, TableShell, Td, Th, Tr } from '@/components/ui/dashboard-ui'
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, WifiOff } from 'lucide-react'
import type { AgentConfig, DashboardSummaryRow, Organization, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

type SystemEvent = {
  id: string
  level: 'info' | 'warning' | 'error'
  source: string
  event_type: string
  message: string
  created_at: string
}

/**
 * Diagnóstico de um cliente (super admin): tudo que a equipe Alizo precisa
 * pra entender e destravar um cliente sem abrir o banco.
 */
export default async function OrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const appUser = await getAppUser()
  if (!appUser?.isSuperAdmin) redirect('/dashboard')

  const { id } = await params
  const supabase = await createClient()

  const [{ data: org }, { data: units }, { data: users }, { data: summary }, { data: events }] = await Promise.all([
    supabase.from('organizations').select('*').eq('id', id).maybeSingle(),
    supabase.from('units').select('*').eq('org_id', id).order('created_at', { ascending: true }),
    supabase.from('users').select('id, email, name, role, is_active').eq('org_id', id).order('created_at', { ascending: true }),
    supabase.from('dashboard_summary').select('*'),
    supabase
      .from('system_events')
      .select('id, level, source, event_type, message, created_at')
      .eq('org_id', id)
      .order('created_at', { ascending: false })
      .limit(12),
  ])

  if (!org) notFound()

  const orgRow = org as Organization
  const unitRows = (units ?? []) as Unit[]
  const userRows = (users ?? []) as { id: string; email: string; name: string | null; role: string; is_active: boolean }[]
  const summaryRows = (summary ?? []) as DashboardSummaryRow[]
  const eventRows = (events ?? []) as SystemEvent[]
  const leadsByUnit = new Map(summaryRows.map((r) => [r.unit_id, r]))

  const unitIds = unitRows.map((u) => u.id)
  const { data: configs } = unitIds.length
    ? await supabase.from('agent_configs').select('*').in('unit_id', unitIds)
    : { data: [] }
  const configRows = (configs ?? []) as AgentConfig[]

  const setup = computeSetupStatus(unitRows, configRows)
  const totalLeads = unitRows.reduce((s, u) => s + Number(leadsByUnit.get(u.id)?.total_leads ?? 0), 0)
  const errorEvents = eventRows.filter((e) => e.level === 'error')

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <Link href="/dashboard/organizations" className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200">
          <ArrowLeft size={12} /> Todos os clientes
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">{orgRow.name}</h1>
            <p className="mt-0.5 text-sm text-slate-400">
              {orgRow.owner_email ?? orgRow.slug} · cliente desde {new Date(orgRow.created_at).toLocaleDateString('pt-BR')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={orgRow.is_active ? 'green' : 'slate'}>{orgRow.is_active ? 'Ativa' : 'Inativa'}</Badge>
            <Badge variant="purple">{orgRow.plan}</Badge>
            <ToggleOrgActive orgId={orgRow.id} isActive={orgRow.is_active} />
          </div>
        </div>
      </div>

      {/* Diagnóstico rápido */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">configuração</p>
          <h2 className="text-sm font-bold text-white">Onde o cliente está</h2>
          <div className="mt-3 space-y-2">
            {setup.steps.map((s) => (
              <div key={s.id} className="flex items-center gap-2.5">
                <div
                  className="flex h-5 w-5 items-center justify-center rounded-full"
                  style={s.done ? { background: 'rgba(34,197,94,0.2)' } : { background: 'rgba(255,255,255,0.06)' }}
                >
                  {s.done ? <Check size={10} className="text-emerald-400" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />}
                </div>
                <span className={`text-sm ${s.done ? 'text-slate-300' : 'text-slate-500'}`}>{s.label}</span>
              </div>
            ))}
          </div>
          {!setup.complete && setup.nextAction && (
            <p className="mt-3 rounded-xl px-3 py-2 text-xs font-semibold text-amber-400" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
              Travado em: {setup.nextAction.label}
            </p>
          )}
        </Card>

        <Card className="p-5">
          <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">números</p>
          <h2 className="text-sm font-bold text-white">Uso da plataforma</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {[
              { label: 'Unidades', value: unitRows.length },
              { label: 'WhatsApp ativos', value: unitRows.filter((u) => u.whatsapp_phone).length },
              { label: 'Leads', value: totalLeads },
              { label: 'Acessos ativos', value: userRows.filter((u) => u.is_active).length },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <p className="text-xl font-black text-white">{value}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">integrações</p>
          <h2 className="text-sm font-bold text-white">Últimos avisos e erros</h2>
          <div className="mt-3 space-y-2">
            {errorEvents.length === 0 && (
              <p className="flex items-center gap-2 text-xs text-emerald-400">
                <CheckCircle2 size={13} /> Nenhum erro recente pra este cliente.
              </p>
            )}
            {eventRows.slice(0, 4).map((e) => (
              <div key={e.id} className="flex items-start gap-2">
                <AlertTriangle
                  size={12}
                  className={`mt-0.5 flex-shrink-0 ${e.level === 'error' ? 'text-red-400' : e.level === 'warning' ? 'text-amber-400' : 'text-slate-500'}`}
                />
                <div className="min-w-0">
                  <p className="truncate text-xs text-slate-300" title={e.message}>{e.message}</p>
                  <p className="text-[10px] text-slate-600">
                    {e.source} · {new Date(e.created_at).toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Unidades */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 className="text-sm font-bold text-white">Unidades</h2>
          <Link
            href={`/dashboard/units/new?org_id=${orgRow.id}`}
            className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-200 transition-all hover:bg-white/5"
            style={{ border: '1px solid rgba(255,255,255,0.1)' }}
          >
            + Nova unidade
          </Link>
        </div>
        {unitRows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Nenhuma unidade — o cliente não vai conseguir usar nada até ter uma.</p>
        ) : (
          <table className="w-full text-sm">
            <TableShell>
              <Th>Unidade</Th>
              <Th>WhatsApp</Th>
              <Th>Funcionário (SDR)</Th>
              <Th>Leads</Th>
              <Th>Instância</Th>
            </TableShell>
            <tbody>
              {unitRows.map((unit) => {
                const cfg = configRows.find((c) => c.unit_id === unit.id && c.agent_type === 'sdr')
                return (
                  <Tr key={unit.id}>
                    <Td>
                      <Link href={`/dashboard/units/${unit.id}`} className="font-semibold text-white hover:text-cyan-400">
                        {unit.name}
                      </Link>
                      <p className="text-[11px] text-slate-500">{unit.region_city ?? '—'}</p>
                    </Td>
                    <Td>
                      {unit.whatsapp_phone ? (
                        <span className="flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}>
                          <CheckCircle2 size={10} /> {unit.whatsapp_phone}
                        </span>
                      ) : (
                        <span className="flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-500" style={{ background: 'rgba(255,255,255,0.05)' }}>
                          <WifiOff size={10} /> Sem conexão
                        </span>
                      )}
                    </Td>
                    <Td>
                      {cfg ? (
                        <span className="text-slate-300">
                          {cfg.persona_name}{' '}
                          <Badge variant={cfg.is_active ? 'green' : 'amber'}>{cfg.is_active ? 'ligado' : 'desligado'}</Badge>
                        </span>
                      ) : (
                        <span className="text-slate-500">não configurado</span>
                      )}
                    </Td>
                    <Td className="text-slate-400">{Number(leadsByUnit.get(unit.id)?.total_leads ?? 0)}</Td>
                    <Td className="font-mono text-[11px] text-slate-500">{unit.evolution_instance_name ?? '—'}</Td>
                  </Tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Acessos */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 className="text-sm font-bold text-white">Acessos do cliente</h2>
          <ProvisionUserForm orgId={orgRow.id} />
        </div>
        {userRows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            Ninguém tem acesso ainda — libere o primeiro acesso acima.
          </p>
        ) : (
          <table className="w-full text-sm">
            <TableShell>
              <Th>Usuário</Th>
              <Th>Papel</Th>
              <Th>Status</Th>
              <Th>Ações</Th>
            </TableShell>
            <tbody>
              {userRows.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    <p className="font-semibold text-white">{u.name ?? u.email}</p>
                    <p className="text-[11px] text-slate-500">{u.email}</p>
                  </Td>
                  <Td className="text-slate-400">{u.role}</Td>
                  <Td>
                    <Badge variant={u.is_active ? 'green' : 'slate'}>{u.is_active ? 'Ativo' : 'Inativo'}</Badge>
                  </Td>
                  <Td>
                    <ResetPasswordButton email={u.email} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
