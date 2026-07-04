import { createClient } from '@/lib/supabase/server'
import type { Organization, Unit } from '@/lib/types'

const PLAN_LABEL: Record<string, string> = {
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

export default async function OrganizationsPage() {
  const supabase = await createClient()

  const [{ data: organizations }, { data: units }] = await Promise.all([
    supabase.from('organizations').select('*').order('created_at', { ascending: false }),
    supabase.from('units').select('id, org_id'),
  ])

  const orgRows = (organizations ?? []) as Organization[]
  const unitRows = (units ?? []) as Pick<Unit, 'id' | 'org_id'>[]

  const unitCountByOrg = new Map<string, number>()
  for (const unit of unitRows) {
    if (!unit.org_id) continue
    unitCountByOrg.set(unit.org_id, (unitCountByOrg.get(unit.org_id) ?? 0) + 1)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Organizações</h1>
        <p className="mt-1 text-sm text-gray-500">Organizações clientes da plataforma.</p>
      </div>

      {orgRows.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white py-24 text-center">
          <div>
            <p className="text-sm font-medium text-gray-500">Nenhuma organização cadastrada</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgRows.map((org) => (
            <div
              key={org.id}
              className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">{org.name}</h2>
                  <p className="mt-0.5 text-xs text-gray-500">{org.slug}</p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    org.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {org.is_active ? 'Ativa' : 'Inativa'}
                </span>
              </div>

              <div className="flex items-center gap-4 border-t border-gray-100 pt-3 text-sm text-gray-600">
                <div>
                  <p className="text-xs text-gray-400">Plano</p>
                  <p className="font-medium text-gray-900">{PLAN_LABEL[org.plan] ?? org.plan}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Unidades</p>
                  <p className="font-medium text-gray-900">{unitCountByOrg.get(org.id) ?? 0}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
