import { createClient } from '@/lib/supabase/server'
import { Building2, Plus, MapPin, Users } from 'lucide-react'
import type { Organization, Unit } from '@/lib/types'
import { Badge, type BadgeVariant, EmptyState, GhostLink, PageHeader, PrimaryButton } from '@/components/ui/dashboard-ui'

const PLAN_VARIANT: Record<string, BadgeVariant> = {
  starter: 'slate',
  pro: 'purple',
  enterprise: 'amber',
}

export default async function OrganizationsPage() {
  const supabase = await createClient()

  const [{ data: organizations }, { data: units }, { data: employees }] = await Promise.all([
    supabase.from('organizations').select('*').order('created_at', { ascending: false }),
    supabase.from('units').select('id, org_id, is_active, whatsapp_phone'),
    supabase.from('employees').select('id, org_id'),
  ])

  const orgRows = (organizations ?? []) as Organization[]
  const unitRows = (units ?? []) as Pick<Unit, 'id' | 'org_id' | 'is_active' | 'whatsapp_phone'>[]
  const empRows = (employees ?? []) as { id: string; org_id: string | null }[]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="gestão"
        title="Empresas"
        subtitle="Clientes da plataforma Alizo."
        action={
          <PrimaryButton href="/dashboard/organizations/new" icon={<Plus size={14} />}>
            Nova empresa
          </PrimaryButton>
        }
      />

      {orgRows.length === 0 ? (
        <div className="rounded-2xl" style={{ border: '1px dashed rgba(255,255,255,0.12)' }}>
          <EmptyState
            icon={<Building2 size={22} className="text-white" />}
            title="Nenhuma empresa cadastrada"
            subtitle="Cadastre a primeira empresa e suas unidades."
            actionHref="/dashboard/organizations/new"
            actionLabel="Cadastrar empresa"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgRows.map((org) => {
            const orgUnits = unitRows.filter(u => u.org_id === org.id)
            const connectedWA = orgUnits.filter(u => u.whatsapp_phone)
            const orgEmployees = empRows.filter(e => e.org_id === org.id)
            const planVariant = PLAN_VARIANT[org.plan] ?? 'slate'

            return (
              <div
                key={org.id}
                className="group flex flex-col gap-4 overflow-hidden rounded-2xl bg-[#141a2b] transition-all duration-200 hover:-translate-y-0.5"
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
              >
                {/* Top accent */}
                <div className="h-[3px] w-full bg-gradient-to-r from-cyan-400 to-indigo-500" />

                <div className="flex flex-col gap-4 px-5 pb-5">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
                        style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 4px 10px rgba(6,182,212,0.25)' }}
                      >
                        <Building2 size={16} className="text-white" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-white">{org.name}</h2>
                        <p className="text-[11px] text-slate-500">{org.owner_email ?? org.slug}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge variant={planVariant}>{org.plan}</Badge>
                      <Badge variant={org.is_active ? 'green' : 'slate'}>{org.is_active ? 'Ativa' : 'Inativa'}</Badge>
                    </div>
                  </div>

                  {/* Stats */}
                  <div
                    className="grid grid-cols-3 gap-2 rounded-xl p-3"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <div className="text-center">
                      <p className="text-xl font-black text-white">{orgUnits.length}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Unidades</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-black text-white">{connectedWA.length}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">WhatsApp</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-black text-white">{orgEmployees.length}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Pessoas</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <div className="flex-1"><GhostLink href={`/dashboard/units?org=${org.id}`} icon={<MapPin size={12} />}>Unidades</GhostLink></div>
                    <div className="flex-1"><GhostLink href={`/dashboard/employees?org=${org.id}`} icon={<Users size={12} />}>Funcionários</GhostLink></div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
