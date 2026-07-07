import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Building2, Plus, MapPin, Users } from 'lucide-react'
import type { Organization, Unit } from '@/lib/types'

const PLAN_COLOR: Record<string, string> = {
  starter: 'bg-gray-100 text-gray-600',
  pro: 'bg-violet-100 text-violet-700',
  enterprise: 'bg-amber-100 text-amber-700',
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Empresas</h1>
          <p className="mt-0.5 text-sm text-gray-500">Clientes da plataforma AI Workforce OS.</p>
        </div>
        <Link
          href="/dashboard/organizations/new"
          className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          <Plus size={15} />
          Nova empresa
        </Link>
      </div>

      {orgRows.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-gray-300 bg-white py-24 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50">
            <Building2 size={24} className="text-blue-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Nenhuma empresa cadastrada</p>
            <p className="mt-1 text-sm text-gray-500">Cadastre a primeira empresa e suas unidades.</p>
          </div>
          <Link
            href="/dashboard/organizations/new"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Cadastrar empresa
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgRows.map((org) => {
            const orgUnits = unitRows.filter(u => u.org_id === org.id)
            const activeUnits = orgUnits.filter(u => u.is_active)
            const connectedWA = orgUnits.filter(u => u.whatsapp_phone)
            const orgEmployees = empRows.filter(e => e.org_id === org.id)

            return (
              <div
                key={org.id}
                className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
                      <Building2 size={18} className="text-blue-600" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">{org.name}</h2>
                      <p className="text-xs text-gray-400">{org.owner_email ?? org.slug}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${PLAN_COLOR[org.plan] ?? 'bg-gray-100 text-gray-600'}`}>
                      {org.plan}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${org.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {org.is_active ? 'Ativa' : 'Inativa'}
                    </span>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3">
                  <div className="text-center">
                    <p className="text-lg font-bold text-gray-900">{orgUnits.length}</p>
                    <p className="text-[11px] text-gray-400">Unidades</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-gray-900">{connectedWA.length}</p>
                    <p className="text-[11px] text-gray-400">WhatsApp</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-gray-900">{orgEmployees.length}</p>
                    <p className="text-[11px] text-gray-400">Funcionários</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Link
                    href={`/dashboard/units?org=${org.id}`}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    <MapPin size={12} />
                    Unidades
                  </Link>
                  <Link
                    href={`/dashboard/employees?org=${org.id}`}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    <Users size={12} />
                    Funcionários
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
