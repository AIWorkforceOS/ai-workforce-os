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
          <h1 className="text-2xl font-bold text-gray-900">Funcionários</h1>
          <p className="mt-0.5 text-sm text-gray-500">Colaboradores cadastrados por unidade.</p>
        </div>
        <Link
          href="/dashboard/employees/new"
          className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          <Plus size={15} />
          Novo funcionário
        </Link>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {employees.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-50">
              <Users size={22} className="text-orange-500" />
            </div>
            <p className="text-sm font-medium text-gray-900">Nenhum funcionário cadastrado</p>
            <p className="text-sm text-gray-500">Adicione colaboradores para cada unidade.</p>
            <Link
              href="/dashboard/employees/new"
              className="mt-1 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
            >
              Cadastrar funcionário
            </Link>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400">
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Empresa / Unidade</th>
                <th className="px-5 py-3 font-medium">Cargo</th>
                <th className="px-5 py-3 font-medium">Contato</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-5 py-3">
                    <Link
                      href={`/dashboard/employees/${emp.id}`}
                      className="font-medium text-gray-900 hover:text-blue-600"
                    >
                      {emp.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-gray-700">{emp.organizations?.name ?? '—'}</p>
                    <p className="text-xs text-gray-400">{emp.units?.name ?? 'Sem unidade'}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                      {ROLE_LABEL[emp.role] ?? emp.role}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500">
                    <p>{emp.email ?? '—'}</p>
                    <p className="text-xs">{emp.phone ?? ''}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      emp.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {emp.is_active ? 'Ativo' : 'Inativo'}
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
