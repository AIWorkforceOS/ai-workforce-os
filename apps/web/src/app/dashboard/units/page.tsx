import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Unit } from '@/lib/types'

export default async function UnitsPage() {
  const supabase = await createClient()
  const { data: units } = await supabase
    .from('units')
    .select('*')
    .order('created_at', { ascending: false })

  const unitRows = (units ?? []) as Unit[]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Unidades</h1>
          <p className="mt-1 text-sm text-gray-500">Gerencie as unidades cadastradas.</p>
        </div>
        <Link
          href="/dashboard/units/new"
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Nova unidade
        </Link>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        {unitRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <p className="text-sm font-medium text-gray-900">Nenhuma unidade cadastrada ainda</p>
            <p className="text-sm text-gray-500">Crie a primeira unidade para começar.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Cidade / Estado</th>
                <th className="px-5 py-3 font-medium">WhatsApp</th>
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
                  <td className="px-5 py-3 text-gray-600">{unit.whatsapp_phone ?? '—'}</td>
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
