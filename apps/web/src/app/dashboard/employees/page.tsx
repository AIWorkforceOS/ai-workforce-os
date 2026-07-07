import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Users, Plus } from 'lucide-react'

type Employee = {
  id: string
  name: string
  email: string | null
  phone: string | null
  role: string
  is_active: boolean
  created_at: string
  unit_id: string | null
  org_id: string | null
  units?: { name: string } | null
  organizations?: { name: string } | null
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  manager: 'Gerente',
  staff: 'Colaborador',
  sdr: 'SDR',
  support: 'Suporte',
}

const ROLE_STYLE: Record<string, { bg: string; color: string }> = {
  admin: { bg: 'rgba(239,68,68,0.1)', color: '#b91c1c' },
  manager: { bg: 'rgba(139,92,246,0.12)', color: '#7c3aed' },
  staff: { bg: 'rgba(148,163,184,0.12)', color: '#475569' },
  sdr: { bg: 'rgba(34,197,94,0.1)', color: '#15803d' },
  support: { bg: 'rgba(59,130,246,0.1)', color: '#1d4ed8' },
}

export default async function EmployeesPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('employees')
    .select('*, units(name), organizations(name)')
    .order('created_at', { ascending: false })

  const employees = (data ?? []) as Employee[]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">equipe</p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-slate-900">Funcionários</h1>
          <p className="mt-0.5 text-sm text-slate-500">Colaboradores cadastrados por unidade.</p>
        </div>
        <Link
          href="/dashboard/employees/new"
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            boxShadow: '0 4px 14px rgba(34,197,94,0.3)',
          }}
        >
          <Plus size={14} />
          Novo funcionário
        </Link>
      </div>

      <div
        className="overflow-hidden rounded-2xl bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(226,232,240,0.7)' }}
      >
        {employees.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ background: 'linear-gradient(135deg, #f97316, #ea580c)', boxShadow: '0 6px 16px rgba(249,115,22,0.25)' }}
            >
              <Users size={22} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Nenhum funcionário cadastrado</p>
              <p className="mt-1 text-sm text-slate-500">Adicione colaboradores para cada unidade.</p>
            </div>
            <Link
              href="/dashboard/employees/new"
              className="rounded-xl px-5 py-2 text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 4px 12px rgba(34,197,94,0.25)' }}
            >
              Cadastrar funcionário
            </Link>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ background: 'rgba(248,250,252,0.9)', borderBottom: '1px solid rgba(226,232,240,0.8)' }}>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Nome</th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Empresa / Unidade</th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Cargo</th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Contato</th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => {
                const roleStyle = ROLE_STYLE[emp.role] ?? { bg: 'rgba(148,163,184,0.12)', color: '#475569' }
                return (
                  <tr key={emp.id} className="border-b border-slate-50 last:border-0 transition-colors hover:bg-slate-50/60">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/dashboard/employees/${emp.id}`}
                        className="font-semibold text-slate-900 transition-colors hover:text-green-600"
                      >
                        {emp.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-slate-700">{emp.organizations?.name ?? '—'}</p>
                      <p className="text-[11px] text-slate-400">{emp.units?.name ?? 'Sem unidade'}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: roleStyle.bg, color: roleStyle.color }}>
                        {ROLE_LABEL[emp.role] ?? emp.role}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">
                      <p className="text-[13px]">{emp.email ?? '—'}</p>
                      <p className="text-[11px]">{emp.phone ?? ''}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                        style={emp.is_active
                          ? { background: 'rgba(34,197,94,0.1)', color: '#15803d' }
                          : { background: 'rgba(148,163,184,0.1)', color: '#64748b' }}
                      >
                        {emp.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
