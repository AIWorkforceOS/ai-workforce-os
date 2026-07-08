'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SECTOR_OPTIONS, type AgentConfig, type AgentTone } from '@/lib/types'
import { Input, Label, Select } from '@/components/ui/dashboard-ui'

const TONE_OPTIONS: { value: AgentTone; label: string }[] = [
  { value: 'professional', label: 'Profissional' },
  { value: 'friendly', label: 'Amigável' },
  { value: 'formal', label: 'Formal' },
]

const SECTOR_LABELS: Record<string, string> = {
  tecnologia: 'Tecnologia',
  industria: 'Indústria',
  comercio: 'Comércio',
  servicos: 'Serviços',
  saude: 'Saúde',
  educacao: 'Educação',
}

export function AgentConfigForm({
  unitId,
  initialConfig,
}: {
  unitId: string
  initialConfig: AgentConfig | null
}) {
  const router = useRouter()
  const [personaName, setPersonaName] = useState(initialConfig?.persona_name ?? 'Assistente')
  const [tone, setTone] = useState<AgentTone>(initialConfig?.persona_tone ?? 'professional')
  const [dailyLimit, setDailyLimit] = useState(initialConfig?.daily_limit ?? 15)
  const [start, setStart] = useState(initialConfig?.active_hours?.start ?? '08:00')
  const [end, setEnd] = useState(initialConfig?.active_hours?.end ?? '18:00')
  const [sectors, setSectors] = useState<string[]>(
    initialConfig?.sectors ?? ['tecnologia', 'industria', 'comercio', 'servicos'],
  )
  const [isActive, setIsActive] = useState(initialConfig?.is_active ?? false)
  const [configId, setConfigId] = useState<string | null>(initialConfig?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  function toggleSector(sector: string) {
    setSectors((current) =>
      current.includes(sector) ? current.filter((s) => s !== sector) : [...current, sector],
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    setLoading(true)

    const supabase = createClient()
    const payload = {
      unit_id: unitId,
      agent_type: 'sdr',
      persona_name: personaName,
      persona_tone: tone,
      daily_limit: dailyLimit,
      active_hours: { start, end, days: initialConfig?.active_hours?.days ?? [1, 2, 3, 4, 5] },
      sectors,
      is_active: isActive,
    }

    const { data, error: saveError } = configId
      ? await supabase.from('agent_configs').update(payload).eq('id', configId).select('id').single()
      : await supabase.from('agent_configs').insert(payload).select('id').single()

    setLoading(false)

    if (saveError || !data) {
      setError('Não foi possível salvar a configuração do agente.')
      return
    }

    setConfigId(data.id)
    setSaved(true)
    router.refresh()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex max-w-xl flex-col gap-6 rounded-2xl p-6"
      style={{ background: '#141a2b', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="personaName">Nome da persona</Label>
        <Input id="personaName" required value={personaName} onChange={(e) => setPersonaName(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tone">Tom</Label>
        <Select id="tone" value={tone} onChange={(e) => setTone(e.target.value as AgentTone)}>
          {TONE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dailyLimit">Limite diário: {dailyLimit}</Label>
        <input
          id="dailyLimit"
          type="range"
          min={1}
          max={15}
          value={dailyLimit}
          onChange={(e) => setDailyLimit(Number(e.target.value))}
          className="accent-cyan-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="start">Início</Label>
          <Input id="start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="end">Fim</Label>
          <Input id="end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Setores</span>
        <div className="grid grid-cols-2 gap-2">
          {SECTOR_OPTIONS.map((sector) => (
            <label key={sector} className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={sectors.includes(sector)}
                onChange={() => toggleSector(sector)}
                className="accent-cyan-500"
              />
              {SECTOR_LABELS[sector]}
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="accent-cyan-500"
        />
        Agente ativo
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {saved && !error && <p className="text-sm text-emerald-400">Configuração salva.</p>}

      <button
        type="submit"
        disabled={loading}
        className="self-start rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
      >
        {loading ? 'Salvando...' : 'Salvar configuração'}
      </button>
    </form>
  )
}
