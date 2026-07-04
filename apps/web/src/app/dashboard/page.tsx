import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { DashboardSummaryRow, Unit } from '@/lib/types'

export default async function DashboardPage() {
  const supabase = await createClient()

  const [{ data: units }, { data: summary }] = await Promise.all([
    supabase.from('units').select('*').order('created_at', { ascending: false }),
    supabase.from('dashboard_summary').select('*'),
  ])

  const unitRows = (units ?? []) as Unit[]
  const summaryRows = (summary ?? []) as DashboardSummaryRow[]

  const leadsByUnit = new Map(summaryRows.map((row) => [row.unit_id, row]))

  const activeUnits = unitRows.filter((unit) => unit.is_active).length
  const totalLeads = summaryRows.reduce((sum, row) => sum + row.total_leads, 0)
  const conversationsToday = summaryRows.reduce((sum, row) => sum + row.conversations_today, 0)
  const wonLeads = summaryRows.reduce((sum, row) => sum + row.won_leads, 0)

  const metrics = [
    { label: 'Unidades ativas', value: activeUnits },
    { label: 'Total de leads', value: totalLeads },
    { label: 'Conversas (24h)', value: conversationsToday },
    { label: 'Leads convertidos', value: wonLeads },
  ]

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Visão geral das suas unidades e agentes.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
          >
            <p className="text-sm text-gray-500">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{metric.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Unidades</h2>
          <Link href="/dashboard/units" className="text-sm text-gray-500 hover:text-gray-900">
            Ver todas
          </Link>
        </div>

        {unitRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <p className="text-sm font-medium text-gray-900">Nenhuma unidade cadastrada ainda</p>
            <p className="text-sm text-gray-500">
              Crie a primeira unidade para começar a configurar seu agente SDR.
            </p>
            <Link
              href="/dashboard/units/new"
              className="mt-3 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
            >
              Nova unidade
            </Link>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Cidade</th>
                <th className="px-5 py-3 font-medium">Leads</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {unitRows.map((unit) => (
                <tr key={unit.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-5 py-3">
                    <Link
                      href={`/dashboard/units/${unit.id}`}
                      className="font-medium text-gray-900 hover:underline"
                    >
                      {unit.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-600">
                    {unit.region_city ?? '—'}
                    {unit.region_state ? `, ${unit.region_state}` : ''}
                  </td>
                  <td className="px-5 py-3 text-gray-600">
                    {leadsByUnit.get(unit.id)?.total_leads ?? 0}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        unit.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {unit.is_active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
