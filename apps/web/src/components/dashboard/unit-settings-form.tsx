'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Unit } from '@/lib/types'

export function UnitSettingsForm({ unit }: { unit: Unit }) {
  const router = useRouter()
  const [whatsapp, setWhatsapp] = useState(unit.whatsapp_phone ?? '')
  const [emailFrom, setEmailFrom] = useState(unit.email_from ?? '')
  const [evolutionApiUrl, setEvolutionApiUrl] = useState(unit.evolution_api_url ?? '')
  const [evolutionApiKey, setEvolutionApiKey] = useState(unit.evolution_api_key ?? '')
  const [evolutionInstanceName, setEvolutionInstanceName] = useState(
    unit.evolution_instance_name ?? '',
  )
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    setLoading(true)

    const supabase = createClient()
    const { error: saveError } = await supabase
      .from('units')
      .update({
        whatsapp_phone: whatsapp || null,
        email_from: emailFrom || null,
        evolution_api_url: evolutionApiUrl || null,
        evolution_api_key: evolutionApiKey || null,
        evolution_instance_name: evolutionInstanceName || null,
      })
      .eq('id', unit.id)

    setLoading(false)

    if (saveError) {
      setError('Não foi possível salvar as alterações.')
      return
    }

    setSaved(true)
    router.refresh()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-gray-900">Dados da unidade</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="whatsapp" className="text-sm font-medium text-gray-700">
            WhatsApp
          </label>
          <input
            id="whatsapp"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
            placeholder="+55 19 99999-9999"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="emailFrom" className="text-sm font-medium text-gray-700">
            Email de envio
          </label>
          <input
            id="emailFrom"
            type="email"
            value={emailFrom}
            onChange={(e) => setEmailFrom(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-gray-100 pt-4">
        <span className="text-sm font-medium text-gray-700">Evolution API (WhatsApp)</span>
        <p className="text-xs text-gray-500">
          Necessário para conectar o WhatsApp desta unidade.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="evolutionApiUrl" className="text-sm font-medium text-gray-700">
            URL da instância
          </label>
          <input
            id="evolutionApiUrl"
            value={evolutionApiUrl}
            onChange={(e) => setEvolutionApiUrl(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
            placeholder="https://evolution.suaempresa.com"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="evolutionInstanceName" className="text-sm font-medium text-gray-700">
            Nome da instância
          </label>
          <input
            id="evolutionInstanceName"
            value={evolutionInstanceName}
            onChange={(e) => setEvolutionInstanceName(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
            placeholder="smarter-campinas"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="evolutionApiKey" className="text-sm font-medium text-gray-700">
          API key
        </label>
        <input
          id="evolutionApiKey"
          type="password"
          value={evolutionApiKey}
          onChange={(e) => setEvolutionApiKey(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
          placeholder="sua_api_key"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && !error && <p className="text-sm text-green-600">Alterações salvas.</p>}

      <button
        type="submit"
        disabled={loading}
        className="self-start rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-50"
      >
        {loading ? 'Salvando...' : 'Salvar alterações'}
      </button>
    </form>
  )
}
