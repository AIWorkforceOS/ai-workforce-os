'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Unit } from '@/lib/types'
import { FormSection, Input, Label } from '@/components/ui/dashboard-ui'

export function UnitSettingsForm({ unit, showAdvanced = false }: { unit: Unit; showAdvanced?: boolean }) {
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
        // Campos técnicos: só o painel interno (equipe Alizo) mexe neles.
        // Sem eles a unidade usa o servidor central de WhatsApp da Alizo.
        ...(showAdvanced
          ? {
              evolution_api_url: evolutionApiUrl || null,
              evolution_api_key: evolutionApiKey || null,
              evolution_instance_name: evolutionInstanceName || null,
            }
          : {}),
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
    <form onSubmit={handleSubmit}>
      <FormSection title="Dados da unidade">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="whatsapp">WhatsApp</Label>
            <Input
              id="whatsapp"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+55 19 99999-9999"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emailFrom">Email de envio</Label>
            <Input
              id="emailFrom"
              type="email"
              value={emailFrom}
              onChange={(e) => setEmailFrom(e.target.value)}
            />
          </div>
        </div>

        {showAdvanced && (
          <>
            <div className="flex flex-col gap-1 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-sm font-medium text-slate-300">Evolution API (interno Alizo)</span>
              <p className="text-xs text-slate-500">
                Deixe em branco para usar o servidor central de WhatsApp da Alizo. Preencha só para
                apontar esta unidade pra uma instância dedicada.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="evolutionApiUrl">URL da instância</Label>
                <Input
                  id="evolutionApiUrl"
                  value={evolutionApiUrl}
                  onChange={(e) => setEvolutionApiUrl(e.target.value)}
                  placeholder="https://evolution.suaempresa.com"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="evolutionInstanceName">Nome da instância</Label>
                <Input
                  id="evolutionInstanceName"
                  value={evolutionInstanceName}
                  onChange={(e) => setEvolutionInstanceName(e.target.value)}
                  placeholder="alizo-campinas"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="evolutionApiKey">API key</Label>
              <Input
                id="evolutionApiKey"
                type="password"
                value={evolutionApiKey}
                onChange={(e) => setEvolutionApiKey(e.target.value)}
                placeholder="sua_api_key"
              />
            </div>
          </>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
        {saved && !error && <p className="text-sm text-emerald-400">Alterações salvas.</p>}

        <button
          type="submit"
          disabled={loading}
          className="self-start rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
        >
          {loading ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </FormSection>
    </form>
  )
}
