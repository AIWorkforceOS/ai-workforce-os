import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Building2, Plus, MapPin, Users } from 'lucide-react'
import type { Organization, Unit } from '@/lib/types'

const PLAN_STYLE: Record<string, { bg: string; color: string }> = {
  starter: { bg: 'rgba(148,163,184,0.12)', color: '#475569' },
  pro: { bg: 'rgba(139,92,246,0.12)', color: '#7c3aed' },
  enterprise: { bg: 'rgba(245,158,11,0.12)', color: '#b45309' },
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">gestão</p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-slate-900">Empresas</h1>
          <p className="mt-0.5 text-sm text-slate-500">Clientes da plataforma AI Workforce OS.</p>
        </div>
        <Link
          href="/dashboard/organizations/new"
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            boxShadow: '0 4px 14px rgba(34,197,94,0.3)',
          }}
        >
          <Plus size={14} />
          Nova empresa
        </Link>
      </div>

      {orgRows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-4 rounded-2xl bg-white py-24 text-center"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(226,232,240,0.7)', borderStyle: 'dashed', borderWidth: 1, borderColor: 'rgba(203,213,225,0.8)' }}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: '0 6px 16px rgba(99,102,241,0.25)' }}>
            <Building2 size={22} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">Nenhuma empresa cadastrada</p>
            <p className="mt-1 text-sm text-slate-500">Cadastre a primeira empresa e suas unidades.</p>
          </div>
          <Link
            href="/dashboard/organizations/new"
            className="rounded-xl px-5 py-2 text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 4px 12px rgba(34,197,94,0.25)' }}
          >
            Cadastrar empresa
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgRows.map((org) => {
            const orgUnits = unitRows.filter(u => u.org_id === org.id)
            const connectedWA = orgUnits.filter(u => u.whatsapp_phone)
            const orgEmployees = empRows.filter(e => e.org_id === org.id)
            const planStyle = PLAN_STYLE[org.plan] ?? { bg: 'rgba(148,163,184,0.12)', color: '#475569' }

            return (
              <div
                key={org.id}
                className="group flex flex-col gap-4 overflow-hidden rounded-2xl bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(226,232,240,0.7)' }}
              >
                {/* Top accent */}
                <div className="h-[3px] w-full" style={{ background: 'linear-gradient(90deg, #3b82f6, #6366f1)' }} />

                <div className="flex flex-col gap-4 px-5 pb-5">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
                        style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: '0 4px 10px rgba(99,102,241,0.2)' }}
                      >
                        <Building2 size={16} className="text-white" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">{org.name}</h2>
                        <p className="text-[11px] text-slate-400">{org.owner_email ?? org.slug}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <span
                        className="rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize"
                        style={{ background: planStyle.bg, color: planStyle.color }}
                      >
                        {org.plan}
                      </span>
                      <span
                        className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                        style={org.is_active
                          ? { background: 'rgba(34,197,94,0.1)', color: '#15803d' }
                          : { background: 'rgba(148,163,184,0.1)', color: '#64748b' }}
                      >
                        {org.is_active ? 'Ativa' : 'Inativa'}
                      </span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div
                    className="grid grid-cols-3 gap-2 rounded-xl p-3"
                    style={{ background: 'rgba(248,250,252,0.9)', border: '1px solid rgba(226,232,240,0.7)' }}
                  >
                    <div className="text-center">
                      <p className="text-xl font-black text-slate-900">{orgUnits.length}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Unidades</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-black text-slate-900">{connectedWA.length}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">WhatsApp</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-black text-slate-900">{orgEmployees.length}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Pessoas</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Link
                      href={`/dashboard/units?org=${org.id}`}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold text-slate-600 transition-all hover:bg-slate-50"
                      style={{ border: '1px solid rgba(226,232,240,0.9)' }}
                    >
                      <MapPin size={12} />
                      Unidades
                    </Link>
                    <Link
                      href={`/dashboard/employees?org=${org.id}`}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold text-slate-600 transition-all hover:bg-slate-50"
                      style={{ border: '1px solid rgba(226,232,240,0.9)' }}
                    >
                      <Users size={12} />
                      Funcionários
                    </Link>
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
