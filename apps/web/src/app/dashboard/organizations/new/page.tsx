'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Plus, Trash2, Check } from 'lucide-react'
import { FormSection, Input, Label, Select } from '@/components/ui/dashboard-ui'

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
        <Link href="/dashboard/organizations" className="text-sm text-slate-400 hover:text-white">← Empresas</Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">Nova empresa</h1>
        <p className="mt-0.5 text-sm text-slate-400">Cadastre a empresa, selecione o plano e adicione suas unidades.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Plan selection */}
        {plans.length > 0 && (
          <FormSection title="Plano contratado">
            <div className="grid grid-cols-3 gap-3">
              {plans.map((plan) => {
                const isSelected = form.plan_id === plan.id
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => handlePlanSelect(plan)}
                    className="relative flex flex-col gap-2 rounded-xl p-4 text-left transition-all"
                    style={isSelected
                      ? { border: '2px solid #06b6d4', background: 'rgba(6,182,212,0.1)' }
                      : { border: '2px solid rgba(255,255,255,0.08)' }}
                  >
                    {isSelected && (
                      <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full" style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)' }}>
                        <Check size={12} className="text-white" />
                      </div>
                    )}
                    <p className="text-sm font-semibold text-white">{plan.name}</p>
                    <p className="text-xs text-slate-400">
                      até {plan.max_units} unidade{plan.max_units > 1 ? 's' : ''} · {plan.max_agents} agente{plan.max_agents > 1 ? 's' : ''}
                    </p>
                  </button>
                )
              })}
            </div>
          </FormSection>
        )}

        {/* Company details */}
        <FormSection title="Dados da empresa">
          <div className="flex flex-col gap-1.5">
            <Label>Nome da empresa *</Label>
            <Input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Alizo Recife" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>E-mail do responsável</Label>
            <Input type="email" value={form.owner_email} onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))} placeholder="contato@empresa.com" />
          </div>

          {/* Financial */}
          <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Cobrança mensal</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Valor mensal (R$)</Label>
                <Input value={form.monthly_fee} onChange={e => setForm(f => ({ ...f, monthly_fee: e.target.value }))} placeholder="1.500,00" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Dia de vencimento</Label>
                <Select value={form.billing_day} onChange={e => setForm(f => ({ ...f, billing_day: e.target.value }))}>
                  {[1,5,10,15,20,25].map(d => (
                    <option key={d} value={d}>Dia {d}</option>
                  ))}
                </Select>
              </div>
            </div>
            {parseFloat(form.monthly_fee.replace(',','.')) > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400">
                <Check size={11} />
                Uma cobrança de R$ {form.monthly_fee} será criada automaticamente em Financeiro → A receber
              </p>
            )}
          </div>
        </FormSection>

        {/* Units */}
        <FormSection
          title="Unidades"
          action={
            <button type="button" onClick={addUnit} className="flex items-center gap-1 text-xs font-semibold" style={{ color: '#06b6d4' }}>
              <Plus size={13} /> Adicionar unidade
            </button>
          }
        >
          <div className="flex flex-col gap-3">
            {units.map((unit, i) => (
              <div key={i} className="relative rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Unidade {i + 1}</span>
                  {units.length > 1 && (
                    <button type="button" onClick={() => removeUnit(i)} className="text-slate-500 hover:text-red-400">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    value={unit.name}
                    onChange={e => updateUnit(i, 'name', e.target.value)}
                    className="col-span-3"
                    placeholder="Nome da unidade *"
                  />
                  <Input value={unit.city} onChange={e => updateUnit(i, 'city', e.target.value)} className="col-span-2" placeholder="Cidade" />
                  <Input value={unit.state} onChange={e => updateUnit(i, 'state', e.target.value)} maxLength={2} className="uppercase" placeholder="UF" />
                </div>
              </div>
            ))}
          </div>
        </FormSection>

        {error && (
          <div className="rounded-xl px-4 py-3 text-sm text-red-400" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            {busy ? 'Criando empresa...' : 'Criar empresa e unidades'}
          </button>
          <Link
            href="/dashboard/organizations"
            className="rounded-xl px-5 py-2.5 text-sm text-slate-300 hover:bg-white/5"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  )
}
