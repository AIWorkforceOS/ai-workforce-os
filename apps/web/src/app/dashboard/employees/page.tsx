import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Users, Plus } from 'lucide-react'
import { Badge, type BadgeVariant, Card, EmptyState, PageHeader, PrimaryButton, TableShell, Td, Th, Tr } from '@/components/ui/dashboard-ui'
import { PAY_TYPE_LABEL } from '@/lib/service-pay'
import type { EmployeePayType } from '@/lib/types'

type Employee = {
  id: string
  name: string
  email: string | null
  phone: string | null
  role: string
  specialty: string | null
  default_pay: number | null
  default_pay_type: EmployeePayType
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
  technician: 'Técnico',
  sdr: 'SDR',
  support: 'Suporte',
}

const ROLE_VARIANT: Record<string, BadgeVariant> = {
  admin: 'red',
  manager: 'purple',
  staff: 'slate',
  technician: 'cyan',
  sdr: 'green',
  support: 'blue',
}

function formatPay(employee: Employee): string {
  if (employee.default_pay === null) return '—'
  const value = employee.default_pay_type === 'percent'
    ? `${employee.default_pay}%`
    : employee.default_pay.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return `${value} · ${PAY_TYPE_LABEL[employee.default_pay_type]}`
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
      <PageHeader
        eyebrow="equipe"
        title="Funcionários"
        subtitle="Colaboradores cadastrados por unidade."
        action={
          <PrimaryButton href="/dashboard/employees/new" icon={<Plus size={14} />}>
            Novo funcionário
          </PrimaryButton>
        }
      />

      <Card className="overflow-hidden">
        {employees.length === 0 ? (
          <EmptyState
            icon={<Users size={22} className="text-white" />}
            title="Nenhum funcionário cadastrado"
            subtitle="Adicione colaboradores para cada unidade."
            actionHref="/dashboard/employees/new"
            actionLabel="Cadastrar funcionário"
          />
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <TableShell>
              <Th>Nome</Th>
              <Th>Empresa / Unidade</Th>
              <Th>Cargo</Th>
              <Th>Contato</Th>
              <Th>Pagamento padrão</Th>
              <Th>Status</Th>
              <Th>Ações</Th>
            </TableShell>
            <tbody>
              {employees.map((emp) => (
                <Tr key={emp.id}>
                  <Td>
                    <p className="font-semibold text-white">{emp.name}</p>
                    {emp.specialty && <p className="text-[11px] text-slate-500">{emp.specialty}</p>}
                  </Td>
                  <Td>
                    <p className="font-medium text-slate-300">{emp.organizations?.name ?? '—'}</p>
                    <p className="text-[11px] text-slate-500">{emp.units?.name ?? 'Sem unidade'}</p>
                  </Td>
                  <Td>
                    <Badge variant={ROLE_VARIANT[emp.role] ?? 'slate'}>{ROLE_LABEL[emp.role] ?? emp.role}</Badge>
                  </Td>
                  <Td className="text-slate-400">
                    <p className="text-[13px]">{emp.email ?? '—'}</p>
                    <p className="text-[11px]">{emp.phone ?? ''}</p>
                  </Td>
                  <Td className="text-slate-400">{formatPay(emp)}</Td>
                  <Td>
                    <Badge variant={emp.is_active ? 'green' : 'slate'}>{emp.is_active ? 'Ativo' : 'Inativo'}</Badge>
                  </Td>
                  <Td>
                    <Link href={`/dashboard/employees/${emp.id}`} className="text-xs font-semibold text-cyan-400 hover:text-cyan-300">
                      Editar
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </div>
  )
}
