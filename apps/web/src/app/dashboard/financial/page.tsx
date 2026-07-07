import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Wallet, Plus, TrendingUp, TrendingDown } from 'lucide-react'

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
const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Financeiro</h1>
          <p className="mt-0.5 text-sm text-slate-500">Cobranças, receitas e custos do sistema.</p>
        </div>
        <Link
          href="/dashboard/financial/new"
          className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-green-700"
        >
          <Plus size={15} />
          Novo lançamento
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'A receber', value: totalReceivable, icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'A pagar', value: totalPayable, icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Recebido', value: totalPaidIn, icon: Wallet, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Pago', value: totalPaidOut, icon: Wallet, color: 'text-slate-600', bg: 'bg-slate-100' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${bg}`}>
              <Icon size={18} className={color} />
            </div>
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-0.5 text-xl font-bold text-slate-900">{fmt(value)}</p>
          </div>
        ))}
      </div>

      {/* Records table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {records.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
              <Wallet size={22} className="text-blue-500" />
            </div>
            <p className="text-sm font-medium text-slate-900">Nenhum lançamento financeiro</p>
            <p className="text-sm text-slate-500">Registre cobranças, receitas e custos do sistema.</p>
            <Link href="/dashboard/financial/new" className="mt-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
              Adicionar lançamento
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Descrição</th>
                <th className="px-5 py-3 font-medium">Tipo</th>
                <th className="px-5 py-3 font-medium">Empresa / Unidade</th>
                <th className="px-5 py-3 font-medium">Vencimento</th>
                <th className="px-5 py-3 font-medium text-right">Valor</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-900">{r.description}</p>
                    <p className="text-xs text-slate-400">{CATEGORY_LABEL[r.category] ?? r.category}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.type === 'receivable' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {r.type === 'receivable' ? 'Receita' : 'Despesa'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-slate-700">{r.organizations?.name ?? '—'}</p>
                    <p className="text-xs text-slate-400">{r.units?.name ?? ''}</p>
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {r.due_date ? new Date(r.due_date).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-900">
                    {fmt(Number(r.amount))}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[r.status] ?? 'bg-slate-100 text-slate-500'}`}>
                      {STATUS_LABEL[r.status] ?? r.status}
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
