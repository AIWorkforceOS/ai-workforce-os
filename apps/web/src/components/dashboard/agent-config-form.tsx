'use client'

import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { AgentConfig, AgentTone, ProspectingProfile } from '@/lib/types'
import { Input, Label, Select } from '@/components/ui/dashboard-ui'

const TONE_OPTIONS: { value: AgentTone; label: string }[] = [
  { value: 'professional', label: 'Profissional' },
  { value: 'friendly', label: 'Amigável' },
  { value: 'formal', label: 'Formal' },
]

// Rótulos dos setores fixos antigos (pré-migration 049) — usados só para
// converter uma config legada em chips de texto livre na primeira edição.
const LEGACY_SECTOR_LABELS: Record<string, string> = {
  tecnologia: 'Tecnologia',
  industria: 'Indústria',
  comercio: 'Comércio',
  servicos: 'Serviços',
  saude: 'Saúde',
  educacao: 'Educação',
}

const HEADCOUNT_OPTIONS = ['1-10', '11-50', '51-200', '200+']

export function AgentConfigForm({
  unitId,
  initialConfig,
  agentType = 'sdr',
}: {
  unitId: string
  initialConfig: AgentConfig | null
  /** 'sdr' (padrão) ou 'recruiter' — segmentação de prospecção só se aplica ao SDR */
  agentType?: 'sdr' | 'recruiter'
}) {
  const router = useRouter()
  const initialProfile = (initialConfig?.prospecting_profile ?? {}) as ProspectingProfile

  const [personaName, setPersonaName] = useState(initialConfig?.persona_name ?? 'Assistente')
  const [tone, setTone] = useState<AgentTone>(initialConfig?.persona_tone ?? 'professional')
  const [dailyLimit, setDailyLimit] = useState(initialConfig?.daily_limit ?? 15)
  const [start, setStart] = useState(initialConfig?.active_hours?.start ?? '08:00')
  const [end, setEnd] = useState(initialConfig?.active_hours?.end ?? '18:00')
  const [isActive, setIsActive] = useState(initialConfig?.is_active ?? false)
  const [configId, setConfigId] = useState<string | null>(initialConfig?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  // ── Perfil de segmentação da prospecção (texto livre, migration 049) ──
  const [mode, setMode] = useState<'business_types' | 'general'>(initialProfile.mode ?? 'business_types')
  const [businessTypes, setBusinessTypes] = useState<string[]>(() => {
    const fromProfile = (initialProfile.business_types ?? []).filter((t) => t.trim().length > 0)
    if (fromProfile.length > 0) return fromProfile
    // Semeia com os setores fixos antigos, se a config é anterior à migração
    return (initialConfig?.sectors ?? []).map((s) => LEGACY_SECTOR_LABELS[s] ?? s)
  })
  const [typeDraft, setTypeDraft] = useState('')
  const [region, setRegion] = useState(initialProfile.region ?? '')
  const [generalSector, setGeneralSector] = useState(initialProfile.general_sector ?? '')
  const [headcount, setHeadcount] = useState(initialProfile.headcount_range ?? '')

  function addBusinessTypes(raw: string) {
    const items = raw
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    if (items.length === 0) return
    setBusinessTypes((current) => {
      const lower = new Set(current.map((c) => c.toLowerCase()))
      return [...current, ...items.filter((item) => !lower.has(item.toLowerCase()))]
    })
    setTypeDraft('')
  }

  function handleTypeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addBusinessTypes(typeDraft)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    setLoading(true)

    // Inclui o que ficou digitado no campo sem apertar Enter
    const pendingTypes = typeDraft
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    const allTypes = [...businessTypes]
    for (const item of pendingTypes) {
      if (!allTypes.some((t) => t.toLowerCase() === item.toLowerCase())) allTypes.push(item)
    }

    const prospectingProfile: ProspectingProfile = {
      mode,
      business_types: allTypes,
      region: region.trim() || null,
      general_sector: generalSector.trim() || null,
      headcount_range: headcount.trim() || null,
    }

    const supabase = createClient()
    const payload = {
      unit_id: unitId,
      agent_type: agentType,
      persona_name: personaName,
      persona_tone: tone,
      daily_limit: dailyLimit,
      active_hours: { start, end, days: initialConfig?.active_hours?.days ?? [1, 2, 3, 4, 5] },
      // sectors (legado) acompanha o perfil novo para as telas antigas que ainda o exibem
      sectors: mode === 'general' ? (generalSector.trim() ? [generalSector.trim()] : []) : allTypes,
      ...(agentType === 'sdr' ? { prospecting_profile: prospectingProfile } : {}),
      is_active: isActive,
    }

    const { data, error: saveError } = configId
      ? await supabase.from('agent_configs').update(payload).eq('id', configId).select('id').single()
      : await supabase.from('agent_configs').insert(payload).select('id').single()

    setLoading(false)

    if (saveError || !data) {
      setError(
        saveError?.message?.includes('interview_required')
          ? 'Este funcionário ainda não concluiu a entrevista de contratação — conclua a entrevista dele (em Equipe digital ou no onboarding) antes de ativá-lo.'
          : 'Não foi possível salvar a configuração do agente.',
      )
      return
    }

    if (mode === 'business_types') setBusinessTypes(allTypes)
    setTypeDraft('')
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
        <Label htmlFor="dailyLimit">Limite diário de abordagens novas: {dailyLimit}</Label>
        <input
          id="dailyLimit"
          type="range"
          min={1}
          max={15}
          value={dailyLimit}
          onChange={(e) => setDailyLimit(Number(e.target.value))}
          className="accent-cyan-500"
        />
        <p className="text-xs text-slate-500">
          Vale só para o primeiro contato com leads novos. Respostas a leads que já estão conversando
          são sempre livres, 24h por dia.
        </p>
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

      {agentType === 'sdr' && (
        <div className="flex flex-col gap-3">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
            Segmentação da prospecção automática
          </span>
          <p className="text-xs text-slate-500">
            O Sales Rep busca empresas sozinho ao longo do dia usando este perfil. A alteração vale já
            na próxima rodada de busca.
          </p>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="radio"
                name="prospectingMode"
                checked={mode === 'business_types'}
                onChange={() => setMode('business_types')}
                className="accent-cyan-500"
              />
              Tipos de negócio específicos
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="radio"
                name="prospectingMode"
                checked={mode === 'general'}
                onChange={() => setMode('general')}
                className="accent-cyan-500"
              />
              Empresas em geral
            </label>
          </div>

          {mode === 'business_types' ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="businessType">Tipos de negócio</Label>
              {businessTypes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {businessTypes.map((type) => (
                    <span
                      key={type}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-slate-200"
                      style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }}
                    >
                      {type}
                      <button
                        type="button"
                        aria-label={`Remover ${type}`}
                        onClick={() => setBusinessTypes((current) => current.filter((t) => t !== type))}
                        className="text-slate-400 hover:text-red-400"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  id="businessType"
                  value={typeDraft}
                  onChange={(e) => setTypeDraft(e.target.value)}
                  onKeyDown={handleTypeKeyDown}
                  placeholder="Ex.: academias, padarias, curso profissionalizante"
                />
                <button
                  type="button"
                  onClick={() => addBusinessTypes(typeDraft)}
                  className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/5"
                  style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  Adicionar
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Texto livre — escreva do seu jeito e aperte Enter (ou vírgula) para adicionar cada tipo.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="generalSector">Setor (texto livre)</Label>
                <Input
                  id="generalSector"
                  value={generalSector}
                  onChange={(e) => setGeneralSector(e.target.value)}
                  placeholder="Ex.: serviços, alimentação — vazio busca empresas de todos os setores"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="headcount">Faixa de funcionários (opcional)</Label>
                <Select id="headcount" value={headcount} onChange={(e) => setHeadcount(e.target.value)}>
                  <option value="">Indiferente</option>
                  {HEADCOUNT_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </Select>
                <p className="text-xs text-slate-500">
                  Aproximado, usado só como referência interna — o Google Maps não informa o número de
                  funcionários, então a busca não filtra por porte.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prospectRegion">Região/bairro específico (opcional)</Label>
            <Input
              id="prospectRegion"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="Ex.: Moema, Zona Sul — vazio usa a cidade da unidade"
            />
          </div>
        </div>
      )}

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
