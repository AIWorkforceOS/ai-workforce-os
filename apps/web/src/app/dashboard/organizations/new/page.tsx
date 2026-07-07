'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Plus, Trash2, Check } from 'lucide-react'

type Plan = { id: string; name: string; price_monthly: number; max_units: number; max_agents: number; features: string[] }
type UnitDraft = { name: string; city: string; state: string }

function slugify(str: string) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function NewOrganizationPage() {
  const router = useRouter()
  const supabase = createClient()
  const [plans, setPlans] = useState<Plan[]>([])
  const [form, setForm] = useState({
    name: '',
    owner_email: '',
    plan_id: '',
    monthly_fee: '',
    billing_day: '1',
  })
  const [units, setUnits] = useState<UnitDraft[]>([{ name: '', city: '', state: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('plans').select('*').eq('is_active', true).order('sort_order')
      .then(({ data }) => {
        const rows = (data ?? []) as Plan[]
        setPlans(rows)
        if (rows.length > 0) {
          const pro = (rows.find(p => p.name === 'Pro') ?? rows[0])!
          setForm(f => ({ ...f, plan_id: pro.id, monthly_fee: String(pro.price_monthly) }))
        }
      })
  }, [])

  const selectedPlan = plans.find(p => p.id === form.plan_id)

  function handlePlanSelect(plan: Plan) {
    setForm(f => ({ ...f, plan_id: plan.id, monthly_fee: String(plan.price_monthly) }))
  }

  function addUnit() { setUnits(u => [...u, { name: '', city: '', state: '' }]) }
  function removeUnit(i: number) { setUnits(u => u.filter((_, idx) => idx !== i)) }
  function updateUnit(i: number, field: keyof UnitDraft, value: string) {
    setUnits(u => u.map((unit, idx) => idx === i ? { ...unit, [field]: value } : unit))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const slug = slugify(form.name)
    const monthlyFee = parseFloat(form.monthly_fee.replace(',', '.')) || 0

    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({
        name: form.name,
        slug,
        plan_id: form.plan_id || null,
        plan: selectedPlan?.name.toLowerCase() ?? 'starter',
        owner_email: form.owner_email || null,
        monthly_fee: monthlyFee || null,
        billing_day: parseInt(form.billing_day) || 1,
      })
      .select()
      .single()

    if (orgErr || !org) {
      setError(orgErr?.message ?? 'Erro ao criar empresa.')
      setBusy(false)
      return
    }

    // Auto-create financial receivable record
    if (monthlyFee > 0) {
      const dueDate = new Date()
      dueDate.setDate(parseInt(form.billing_day) || 1)
      if (dueDate < new Date()) dueDate.setMonth(dueDate.getMonth() + 1)

      await supabase.from('financial_records').insert({
        org_id: org.id,
        type: 'receivable',
        category: 'client_payment',
        description: `Mensalidade — ${form.name} (${selectedPlan?.name ?? 'Plano'})`,
        amount: monthlyFee,
        due_date: dueDate.toISOString().slice(0, 10),
        status: 'pending',
        notes: `Gerado automaticamente no cadastro da empresa. Dia de vencimento: ${form.billing_day}`,
      })
    }

    // Create units
    const validUnits = units.filter(u => u.name.trim())
    if (validUnits.length > 0) {
      const unitInserts = validUnits.map((u, i) => ({
        org_id: org.id,
        name: u.name,
        slug: `${slug}-${slugify(u.name) || i}`,
        region_city: u.city || null,
        region_state: u.state || null,
      }))
      const { error: unitErr } = await supabase.from('units').insert(unitInserts)
      if (unitErr) {
        setError(`Empresa criada, mas erro nas unidades: ${unitErr.message}`)
        setBusy(false)
        return
      }
    }

    router.push('/dashboard/organizations')
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link href="/dashboard/organizations" className="text-sm text-gray-500 hover:text-gray-700">← Empresas</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Nova empresa</h1>
        <p className="mt-0.5 text-sm text-gray-500">Cadastre a empresa, selecione o plano e adicione suas unidades.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Plan selection */}
        {plans.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Plano contratado</h2>
            <div className="grid grid-cols-3 gap-3">
              {plans.map((plan) => {
                const isSelected = form.plan_id === plan.id
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => handlePlanSelect(plan)}
                    className={`relative flex flex-col gap-2 rounded-xl border-2 p-4 text-left transition-all ${
                      isSelected ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-green-500">
                        <Check size={12} className="text-white" />
                      </div>
                    )}
                    <p className="text-sm font-semibold">{plan.name}</p>
                    <p className={`text-xs ${isSelected ? 'text-zinc-400' : 'text-gray-500'}`}>
                      até {plan.max_units} unidade{plan.max_units > 1 ? 's' : ''} · {plan.max_agents} agente{plan.max_agents > 1 ? 's' : ''}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Company details */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">Dados da empresa</h2>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">Nome da empresa *</label>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
                placeholder="Smarter Estágios Recife" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">E-mail do responsável</label>
              <input type="email" value={form.owner_email} onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
                placeholder="contato@empresa.com" />
            </div>

            {/* Financial */}
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">Cobrança mensal</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700">Valor mensal (R$)</label>
                  <input value={form.monthly_fee} onChange={e => setForm(f => ({ ...f, monthly_fee: e.target.value }))}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
                    placeholder="1.500,00" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700">Dia de vencimento</label>
                  <select value={form.billing_day} onChange={e => setForm(f => ({ ...f, billing_day: e.target.value }))}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400">
                    {[1,5,10,15,20,25].map(d => (
                      <option key={d} value={d}>Dia {d}</option>
                    ))}
                  </select>
                </div>
              </div>
              {parseFloat(form.monthly_fee.replace(',','.')) > 0 && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-green-700">
                  <Check size={11} />
                  Uma cobrança de R$ {form.monthly_fee} será criada automaticamente em Financeiro → A receber
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Units */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              Unidades
              <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{units.length}</span>
            </h2>
            <button type="button" onClick={addUnit} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
              <Plus size={13} /> Adicionar unidade
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {units.map((unit, i) => (
              <div key={i} className="relative rounded-lg border border-gray-100 bg-gray-50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">Unidade {i + 1}</span>
                  {units.length > 1 && (
                    <button type="button" onClick={() => removeUnit(i)} className="text-gray-400 hover:text-red-500">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input value={unit.name} onChange={e => updateUnit(i, 'name', e.target.value)}
                    className="col-span-3 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-400"
                    placeholder="Nome da unidade *" />
                  <input value={unit.city} onChange={e => updateUnit(i, 'city', e.target.value)}
                    className="col-span-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-400"
                    placeholder="Cidade" />
                  <input value={unit.state} onChange={e => updateUnit(i, 'state', e.target.value)} maxLength={2}
                    className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm uppercase outline-none focus:border-gray-400"
                    placeholder="UF" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="flex gap-3">
          <button type="submit" disabled={busy}
            className="flex-1 rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
            {busy ? 'Criando empresa...' : 'Criar empresa e unidades'}
          </button>
          <Link href="/dashboard/organizations" className="rounded-lg border border-gray-200 px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  )
}
