import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CopyWhatsAppLink } from '@/components/dashboard/copy-whatsapp-link'
import type { Unit } from '@/lib/types'
import { Plus, MapPin } from 'lucide-react'

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
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">gestão</p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-slate-900">Unidades</h1>
          <p className="mt-0.5 text-sm text-slate-500">Gerencie as unidades cadastradas.</p>
        </div>
        <Link
          href="/dashboard/units/new"
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            boxShadow: '0 4px 14px rgba(34,197,94,0.3)',
          }}
        >
          <Plus size={14} />
          Nova unidade
        </Link>
      </div>

      <div
        className="overflow-hidden rounded-2xl bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(226,232,240,0.7)' }}
      >
        {unitRows.length === 0 ? (
          <div className="flex flex-col items-center gap-4 px-5 py-20 text-center">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', boxShadow: '0 6px 16px rgba(139,92,246,0.25)' }}
            >
              <MapPin size={22} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Nenhuma unidade cadastrada</p>
              <p className="mt-1 text-sm text-slate-500">Crie a primeira unidade para começar.</p>
            </div>
            <Link
              href="/dashboard/units/new"
              className="rounded-xl px-5 py-2 text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 4px 12px rgba(34,197,94,0.25)' }}
            >
              Criar unidade
            </Link>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ background: 'rgba(248,250,252,0.9)', borderBottom: '1px solid rgba(226,232,240,0.8)' }}>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Nome</th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Cidade / Estado</th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">WhatsApp</th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Status</th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Conexão</th>
              </tr>
            </thead>
            <tbody>
              {unitRows.map((unit) => (
                <tr key={unit.id} className="border-b border-slate-50 last:border-0 transition-colors hover:bg-slate-50/60">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/dashboard/units/${unit.id}`}
                      className="font-semibold text-slate-900 transition-colors hover:text-green-600"
                    >
                      {unit.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">
                    {unit.region_city ?? '—'}
                    {unit.region_state ? `, ${unit.region_state}` : ''}
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">{unit.whatsapp_phone ?? '—'}</td>
                  <td className="px-5 py-3.5">
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                      style={unit.is_active
                        ? { background: 'rgba(34,197,94,0.1)', color: '#15803d' }
                        : { background: 'rgba(148,163,184,0.1)', color: '#64748b' }}
                    >
                      {unit.is_active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
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
