'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { FormSection, Input, Label } from '@/components/ui/dashboard-ui'

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export default function NewUnitPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [emailFrom, setEmailFrom] = useState('')
  const [evolutionApiUrl, setEvolutionApiUrl] = useState('')
  const [evolutionApiKey, setEvolutionApiKey] = useState('')
  const [evolutionInstanceName, setEvolutionInstanceName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleNameChange(value: string) {
    setName(value)
    if (!slugTouched) {
      setSlug(slugify(value))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', 'smarter')
      .single()

    if (orgError || !org) {
      setError('Não foi possível encontrar a organização padrão.')
      setLoading(false)
      return
    }

    const { data: unit, error: insertError } = await supabase
      .from('units')
      .insert({
        org_id: org.id,
        name,
        slug,
        region_city: city || null,
        region_state: state || null,
        whatsapp_phone: whatsapp || null,
        email_from: emailFrom || null,
        evolution_api_url: evolutionApiUrl || null,
        evolution_api_key: evolutionApiKey || null,
        evolution_instance_name: evolutionInstanceName || null,
      })
      .select('id')
      .single()

    setLoading(false)

    if (insertError || !unit) {
      setError('Não foi possível criar a unidade. Verifique se o slug já está em uso.')
      return
    }

    router.push(`/dashboard/units/${unit.id}`)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">gestão</p>
        <h1 className="mt-0.5 text-2xl font-black tracking-tight text-white">Nova unidade</h1>
        <p className="mt-0.5 text-sm text-slate-400">Cadastre uma nova unidade.</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-xl">
        <FormSection title="Dados da unidade">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Nome</Label>
            <Input id="name" required value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Alizo Campinas" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              required
              value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)) }}
              placeholder="alizo-campinas"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="city">Cidade</Label>
              <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Campinas" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="state">Estado</Label>
              <Input id="state" value={state} onChange={(e) => setState(e.target.value)} placeholder="SP" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="whatsapp">WhatsApp</Label>
            <Input id="whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+55 19 99999-9999" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emailFrom">Email de envio</Label>
            <Input
              id="emailFrom"
              type="email"
              value={emailFrom}
              onChange={(e) => setEmailFrom(e.target.value)}
              placeholder="campinas@alizo.com.br"
            />
          </div>

          <div className="flex flex-col gap-1 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <span className="text-sm font-medium text-slate-300">Evolution API (WhatsApp)</span>
            <p className="text-xs text-slate-500">Opcional. Preencha para conectar o WhatsApp desta unidade.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="evolutionApiUrl">URL da instância</Label>
            <Input id="evolutionApiUrl" value={evolutionApiUrl} onChange={(e) => setEvolutionApiUrl(e.target.value)} placeholder="https://evolution.suaempresa.com" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="evolutionApiKey">API key</Label>
            <Input id="evolutionApiKey" type="password" value={evolutionApiKey} onChange={(e) => setEvolutionApiKey(e.target.value)} placeholder="sua_api_key" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="evolutionInstanceName">Nome da instância</Label>
            <Input id="evolutionInstanceName" value={evolutionInstanceName} onChange={(e) => setEvolutionInstanceName(e.target.value)} placeholder="alizo-campinas" />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 self-start rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            {loading ? 'Salvando...' : 'Salvar unidade'}
          </button>
        </FormSection>
      </form>
    </div>
  )
}
