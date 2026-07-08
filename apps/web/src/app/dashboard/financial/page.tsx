import { createClient } from '@/lib/supabase/server'
import { Wallet, Plus, TrendingUp, TrendingDown, DollarSign } from 'lucide-react'
import { Badge, type BadgeVariant, Card, EmptyState, PageHeader, PrimaryButton, TableShell, Td, Th, Tr } from '@/components/ui/dashboard-ui'

type FinancialRecord = {
  id: string
  type: 'receivable' | 'payable'
  category: string
  description: string
  amount: number
  due_date: string | null
  paid_at: string | null
  status: 'pending' | 'paid' | 'overdue' | 'cancelled'
  notes: string | null
  created_at: string
  organizations?: { name: string } | null
  units?: { name: string } | null
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  overdue: 'Vencido',
  cancelled: 'Cancelado',
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'amber',
  paid: 'green',
  overdue: 'red',
  cancelled: 'slate',
}

const CATEGORY_LABEL: Record<string, string> = {
  system_cost: 'Custo do sistema',
  client_payment: 'Pagamento de cliente',
  vendor: 'Fornecedor',
  infrastructure: 'Infraestrutura',
  other: 'Outro',
}

function fmt(val: number) {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function FinancialPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('financial_records')
    .select('*, organizations(name), units(name)')
    .order('created_at', { ascending: false })

  const records = (data ?? []) as FinancialRecord[]

  const totalReceivable = records.filter(r => r.type === 'receivable' && r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0)
  const totalPayable = records.filter(r => r.type === 'payable' && r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0)
  const totalPaidIn = records.filter(r => r.type === 'receivable' && r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0)
  const totalPaidOut = records.filter(r => r.type === 'payable' && r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0)

  const summaryCards = [
    { label: 'A receber', value: totalReceivable, icon: TrendingUp, topBar: 'from-emerald-400 to-green-500', iconGrad: 'from-emerald-400 to-green-500' },
    { label: 'A pagar', value: totalPayable, icon: TrendingDown, topBar: 'from-red-400 to-rose-500', iconGrad: 'from-red-400 to-rose-500' },
    { label: 'Recebido', value: totalPaidIn, icon: Wallet, topBar: 'from-cyan-400 to-indigo-500', iconGrad: 'from-cyan-400 to-indigo-500' },
    { label: 'Pago', value: totalPaidOut, icon: DollarSign, topBar: 'from-slate-400 to-slate-500', iconGrad: 'from-slate-400 to-slate-500' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="módulo"
        title="Financeiro"
        subtitle="Cobranças, receitas e custos do sistema."
        action={
          <PrimaryButton href="/dashboard/financial/new" icon={<Plus size={14} />}>
            Novo lançamento
          </PrimaryButton>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summaryCards.map(({ label, value, icon: Icon, topBar, iconGrad }) => (
          <div key={label} className="relative overflow-hidden rounded-2xl bg-[#141a2b]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}>
            <div className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${topBar}`} />
            <div className="p-4 pt-5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${iconGrad}`} style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
                <Icon size={16} className="text-white" />
              </div>
              <p className="mt-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">{label}</p>
              <p className="mt-1 text-xl font-black tracking-tight text-white">{fmt(value)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Records table */}
      <Card className="overflow-hidden">
        {records.length === 0 ? (
          <EmptyState
            icon={<Wallet size={22} className="text-white" />}
            title="Nenhum lançamento financeiro"
            subtitle="Registre cobranças, receitas e custos do sistema."
            actionHref="/dashboard/financial/new"
            actionLabel="Adicionar lançamento"
          />
        ) : (
          <table className="w-full text-sm">
            <TableShell>
              <Th>Descrição</Th>
              <Th>Tipo</Th>
              <Th>Empresa / Unidade</Th>
              <Th>Vencimento</Th>
              <th className="px-5 py-3 text-right text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Valor</th>
              <Th>Status</Th>
            </TableShell>
            <tbody>
              {records.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <p className="font-semibold text-white">{r.description}</p>
                    <p className="text-[11px] text-slate-500">{CATEGORY_LABEL[r.category] ?? r.category}</p>
                  </Td>
                  <Td>
                    <Badge variant={r.type === 'receivable' ? 'green' : 'red'}>{r.type === 'receivable' ? 'Receita' : 'Despesa'}</Badge>
                  </Td>
                  <Td>
                    <p className="font-medium text-slate-300">{r.organizations?.name ?? '—'}</p>
                    <p className="text-[11px] text-slate-500">{r.units?.name ?? ''}</p>
                  </Td>
                  <Td className="text-slate-400">
                    {r.due_date ? new Date(r.due_date).toLocaleDateString('pt-BR') : '—'}
                  </Td>
                  <Td className="text-right font-black text-white">{fmt(Number(r.amount))}</Td>
                  <Td>
                    <Badge variant={STATUS_VARIANT[r.status] ?? 'slate'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
