'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
        <h1 className="text-xl font-semibold text-slate-900">Nova unidade</h1>
        <p className="mt-1 text-sm text-slate-500">Cadastre uma nova unidade.</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex max-w-xl flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-sm font-medium text-slate-700">
            Nome
          </label>
          <input
            id="name"
            required
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            placeholder="Smarter Campinas"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="slug" className="text-sm font-medium text-slate-700">
            Slug
          </label>
          <input
            id="slug"
            required
            value={slug}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(slugify(e.target.value))
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            placeholder="smarter-campinas"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="city" className="text-sm font-medium text-slate-700">
              Cidade
            </label>
            <input
              id="city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
              placeholder="Campinas"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="state" className="text-sm font-medium text-slate-700">
              Estado
            </label>
            <input
              id="state"
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
              placeholder="SP"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="whatsapp" className="text-sm font-medium text-slate-700">
            WhatsApp
          </label>
          <input
            id="whatsapp"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            placeholder="+55 19 99999-9999"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="emailFrom" className="text-sm font-medium text-slate-700">
            Email de envio
          </label>
          <input
            id="emailFrom"
            type="email"
            value={emailFrom}
            onChange={(e) => setEmailFrom(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            placeholder="campinas@smarterestagios.com.br"
          />
        </div>

        <div className="flex flex-col gap-1 border-t border-slate-100 pt-4">
          <span className="text-sm font-medium text-slate-700">Evolution API (WhatsApp)</span>
          <p className="text-xs text-slate-500">
            Opcional. Preencha para conectar o WhatsApp desta unidade.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="evolutionApiUrl" className="text-sm font-medium text-slate-700">
            URL da instância
          </label>
          <input
            id="evolutionApiUrl"
            value={evolutionApiUrl}
            onChange={(e) => setEvolutionApiUrl(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            placeholder="https://evolution.suaempresa.com"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="evolutionApiKey" className="text-sm font-medium text-slate-700">
            API key
          </label>
          <input
            id="evolutionApiKey"
            type="password"
            value={evolutionApiKey}
            onChange={(e) => setEvolutionApiKey(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            placeholder="sua_api_key"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="evolutionInstanceName" className="text-sm font-medium text-slate-700">
            Nome da instância
          </label>
          <input
            id="evolutionInstanceName"
            value={evolutionInstanceName}
            onChange={(e) => setEvolutionInstanceName(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            placeholder="smarter-campinas"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 self-start rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? 'Salvando...' : 'Salvar unidade'}
        </button>
      </form>
    </div>
  )
}
