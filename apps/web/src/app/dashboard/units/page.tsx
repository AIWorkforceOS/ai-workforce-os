import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CopyWhatsAppLink } from '@/components/dashboard/copy-whatsapp-link'
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
          <h1 className="text-xl font-semibold text-slate-900">Unidades</h1>
          <p className="mt-1 text-sm text-slate-500">Gerencie as unidades cadastradas.</p>
        </div>
        <Link
          href="/dashboard/units/new"
          className="flex items-center gap-1.5 rounded-md bg-green-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-green-700"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nova unidade
        </Link>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        {unitRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <p className="text-sm font-medium text-slate-900">Nenhuma unidade cadastrada ainda</p>
            <p className="text-sm text-slate-500">Crie a primeira unidade para começar.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Cidade / Estado</th>
                <th className="px-5 py-3 font-medium">WhatsApp</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Conexão</th>
              </tr>
            </thead>
            <tbody>
              {unitRows.map((unit) => (
                <tr key={unit.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link
                      href={`/dashboard/units/${unit.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {unit.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {unit.region_city ?? '—'}
                    {unit.region_state ? `, ${unit.region_state}` : ''}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{unit.whatsapp_phone ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        unit.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {unit.is_active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <CopyWhatsAppLink unitId={unit.id} />
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
