import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Wallet, Plus, TrendingUp, TrendingDown, DollarSign } from 'lucide-react'

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

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  pending: { bg: 'rgba(245,158,11,0.1)', color: '#b45309' },
  paid: { bg: 'rgba(34,197,94,0.1)', color: '#15803d' },
  overdue: { bg: 'rgba(239,68,68,0.1)', color: '#b91c1c' },
  cancelled: { bg: 'rgba(148,163,184,0.1)', color: '#64748b' },
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
    {
      label: 'A receber',
      value: totalReceivable,
      icon: TrendingUp,
      topBar: 'from-green-400 to-emerald-500',
      iconGrad: 'from-green-500 to-emerald-500',
    },
    {
      label: 'A pagar',
      value: totalPayable,
      icon: TrendingDown,
      topBar: 'from-red-400 to-rose-500',
      iconGrad: 'from-red-400 to-rose-500',
    },
    {
      label: 'Recebido',
      value: totalPaidIn,
      icon: Wallet,
      topBar: 'from-blue-400 to-indigo-500',
      iconGrad: 'from-blue-400 to-indigo-500',
    },
    {
      label: 'Pago',
      value: totalPaidOut,
      icon: DollarSign,
      topBar: 'from-slate-400 to-slate-500',
      iconGrad: 'from-slate-400 to-slate-500',
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">módulo</p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-slate-900">Financeiro</h1>
          <p className="mt-0.5 text-sm text-slate-500">Cobranças, receitas e custos do sistema.</p>
        </div>
        <Link
          href="/dashboard/financial/new"
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            boxShadow: '0 4px 14px rgba(34,197,94,0.3)',
          }}
        >
          <Plus size={14} />
          Novo lançamento
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summaryCards.map(({ label, value, icon: Icon, topBar, iconGrad }) => (
          <div
            key={label}
            className="relative overflow-hidden rounded-2xl bg-white"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(226,232,240,0.7)' }}
          >
            <div className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${topBar}`} />
            <div className="p-4 pt-5">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${iconGrad}`}
                style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.12)' }}
              >
                <Icon size={16} className="text-white" />
              </div>
              <p className="mt-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">{label}</p>
              <p className="mt-1 text-xl font-black tracking-tight text-slate-900">{fmt(value)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Records table */}
      <div
        className="overflow-hidden rounded-2xl bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(226,232,240,0.7)' }}
      >
        {records.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: '0 6px 16px rgba(99,102,241,0.25)' }}
            >
              <Wallet size={22} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Nenhum lançamento financeiro</p>
              <p className="mt-1 text-sm text-slate-500">Registre cobranças, receitas e custos do sistema.</p>
            </div>
            <Link
              href="/dashboard/financial/new"
              className="rounded-xl px-5 py-2 text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 4px 12px rgba(34,197,94,0.25)' }}
            >
              Adicionar lançamento
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'rgba(248,250,252,0.9)', borderBottom: '1px solid rgba(226,232,240,0.8)' }}>
                <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Descrição</th>
                <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Tipo</th>
                <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Empresa / Unidade</th>
                <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Vencimento</th>
                <th className="px-5 py-3 text-right text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Valor</th>
                <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const statusStyle = STATUS_STYLE[r.status] ?? { bg: 'rgba(148,163,184,0.1)', color: '#64748b' }
                return (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0 transition-colors hover:bg-slate-50/60">
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-slate-900">{r.description}</p>
                      <p className="text-[11px] text-slate-400">{CATEGORY_LABEL[r.category] ?? r.category}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                        style={r.type === 'receivable'
                          ? { background: 'rgba(34,197,94,0.1)', color: '#15803d' }
                          : { background: 'rgba(239,68,68,0.1)', color: '#b91c1c' }}
                      >
                        {r.type === 'receivable' ? 'Receita' : 'Despesa'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-slate-700">{r.organizations?.name ?? '—'}</p>
                      <p className="text-[11px] text-slate-400">{r.units?.name ?? ''}</p>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">
                      {r.due_date ? new Date(r.due_date).toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right font-black text-slate-900">
                      {fmt(Number(r.amount))}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: statusStyle.bg, color: statusStyle.color }}>
                        {STATUS_LABEL[r.status] ?? r.status}
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
