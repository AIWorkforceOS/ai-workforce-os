import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { computeSetupStatus } from '@/lib/setup-status'
import { Building2, Plus } from 'lucide-react'
import type { AgentConfig, DashboardSummaryRow, Organization, Unit } from '@/lib/types'
import { Badge, type BadgeVariant, Card, EmptyState, PageHeader, PrimaryButton, TableShell, Td, Th, Tr } from '@/components/ui/dashboard-ui'
import { DeleteOrgButton } from '@/components/admin/org-actions'

export const dynamic = 'force-dynamic'

const PLAN_VARIANT: Record<string, BadgeVariant> = {
  starter: 'slate',
  pro: 'purple',
  enterprise: 'amber',
}

export default async function OrganizationsPage() {
  const appUser = await getAppUser()
  const supabase = await createClient()

  const [{ data: organizations }, { data: units }, { data: configs }, { data: users }, { data: summary }, { data: candidates }] = await Promise.all([
    supabase.from('organizations').select('*').order('created_at', { ascending: false }),
    supabase.from('units').select('id, org_id, name, is_active, whatsapp_phone'),
    supabase.from('agent_configs').select('unit_id, agent_type, is_active, persona_name'),
    supabase.from('users').select('id, org_id, is_active'),
    supabase.from('dashboard_summary').select('*'),
    supabase.from('candidates').select('org_id'),
  ])

  const orgRows = (organizations ?? []) as Organization[]
  const unitRows = (units ?? []) as Pick<Unit, 'id' | 'org_id' | 'name' | 'is_active' | 'whatsapp_phone'>[]
  const configRows = (configs ?? []) as Pick<AgentConfig, 'unit_id' | 'agent_type' | 'is_active' | 'persona_name'>[]
  const userRows = (users ?? []) as { id: string; org_id: string | null; is_active: boolean }[]
  const summaryRows = (summary ?? []) as DashboardSummaryRow[]
  const candidateRows = (candidates ?? []) as { org_id: string }[]
  const leadsByUnit = new Map(summaryRows.map((r) => [r.unit_id, r]))

  const health = orgRows.map((org) => {
    const orgUnits = unitRows.filter((u) => u.org_id === org.id)
    const orgConfigs = configRows.filter((c) => orgUnits.some((u) => u.id === c.unit_id))
    const setup = computeSetupStatus(orgUnits, orgConfigs)
    return {
      org,
      setup,
      unitCount: orgUnits.length,
      whatsappCount: orgUnits.filter((u) => u.whatsapp_phone).length,
      userCount: userRows.filter((u) => u.org_id === org.id && u.is_active).length,
      totalLeads: orgUnits.reduce((s, u) => s + Number(leadsByUnit.get(u.id)?.total_leads ?? 0), 0),
      totalConversations: orgUnits.reduce((s, u) => s + Number(leadsByUnit.get(u.id)?.total_conversations ?? 0), 0),
      candidateCount: candidateRows.filter((c) => c.org_id === org.id).length,
    }
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="operação alizo"
        title="Clientes"
        subtitle="Todas as empresas da plataforma, com o estado de configuração de cada uma."
        action={
          <PrimaryButton href="/dashboard/organizations/new" icon={<Plus size={14} />}>
            Novo cliente
          </PrimaryButton>
        }
      />

      {orgRows.length === 0 ? (
        <div className="rounded-2xl" style={{ border: '1px dashed rgba(255,255,255,0.12)' }}>
          <EmptyState
            icon={<Building2 size={22} className="text-white" />}
            title="Nenhum cliente cadastrado"
            subtitle="Cadastre o primeiro cliente e provisione o acesso dele."
            actionHref="/dashboard/organizations/new"
            actionLabel="Cadastrar cliente"
          />
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <TableShell>
              <Th>Cliente</Th>
              <Th>Plano</Th>
              <Th>Configuração</Th>
              <Th>WhatsApp</Th>
              <Th>Acessos</Th>
              <Th>Leads</Th>
              <Th>Status</Th>
              {appUser?.isSuperAdmin && <Th>Ações</Th>}
            </TableShell>
            <tbody>
              {health.map(({ org, setup, unitCount, whatsappCount, userCount, totalLeads, totalConversations, candidateCount }) => (
                <Tr key={org.id}>
                  <Td>
                    <Link href={`/dashboard/organizations/${org.id}`} className="font-semibold text-white transition-colors hover:text-cyan-400">
                      {org.name}
                    </Link>
                    <p className="text-[11px] text-slate-500">{org.owner_email ?? org.slug}</p>
                  </Td>
                  <Td>
                    <Badge variant={PLAN_VARIANT[org.plan] ?? 'slate'}>{org.plan}</Badge>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${setup.progress}%`, background: setup.complete ? '#4ade80' : 'linear-gradient(90deg,#06b6d4,#4361ee)' }}
                        />
                      </div>
                      <span className="text-[11px] font-bold text-slate-400">{setup.progress}%</span>
                    </div>
                    {!setup.complete && setup.nextAction && (
                      <p className="mt-1 text-[11px] text-amber-400">Parado em: {setup.nextAction.label.toLowerCase()}</p>
                    )}
                  </Td>
                  <Td>
                    <Badge variant={whatsappCount > 0 ? 'green' : unitCount > 0 ? 'amber' : 'slate'}>
                      {whatsappCount}/{unitCount} unid.
                    </Badge>
                  </Td>
                  <Td className="text-slate-400">{userCount}</Td>
                  <Td className="text-slate-400">{totalLeads}</Td>
                  <Td>
                    <Badge variant={org.is_active ? 'green' : 'slate'}>{org.is_active ? 'Ativa' : 'Inativa'}</Badge>
                  </Td>
                  {appUser?.isSuperAdmin && (
                    <Td>
                      <DeleteOrgButton
                        orgId={org.id}
                        orgName={org.name}
                        summary={{
                          units: unitCount,
                          users: userCount,
                          leads: totalLeads,
                          conversations: totalConversations,
                          candidates: candidateCount,
                        }}
                        compact
                      />
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}
    </div>
  )
}
