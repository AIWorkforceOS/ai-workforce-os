'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getBusinessHours, getSchedulingSettings } from '@/lib/scheduling'
import type { SchedulingSettings, Unit, WeeklySchedule } from '@/lib/types'
import { FormSection, Input, Label, Select } from '@/components/ui/dashboard-ui'
import { WeeklyScheduleEditor } from '@/components/dashboard/weekly-schedule-editor'

// Fusos cobrindo as regiões já atendidas pelo produto (BR + EUA, ver
// lib/i18n e region_language) — lista curada em vez de todos os IANA.
const TIMEZONE_OPTIONS = [
  { value: 'America/Sao_Paulo', label: 'Brasília (America/Sao_Paulo)' },
  { value: 'America/Manaus', label: 'Manaus (America/Manaus)' },
  { value: 'America/Belem', label: 'Belém (America/Belem)' },
  { value: 'America/Fortaleza', label: 'Fortaleza (America/Fortaleza)' },
  { value: 'America/Recife', label: 'Recife (America/Recife)' },
  { value: 'America/Bahia', label: 'Bahia (America/Bahia)' },
  { value: 'America/New_York', label: 'Eastern Time (America/New_York)' },
  { value: 'America/Chicago', label: 'Central Time (America/Chicago)' },
  { value: 'America/Denver', label: 'Mountain Time (America/Denver)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (America/Los_Angeles)' },
]

const SLOT_INTERVAL_OPTIONS = [15, 20, 30, 45, 60]

export function SchedulingConfigForm({ unit }: { unit: Unit }) {
  const router = useRouter()
  const [timezone, setTimezone] = useState(unit.timezone || 'America/Sao_Paulo')
  const [businessHours, setBusinessHours] = useState<WeeklySchedule>(() => getBusinessHours(unit))
  const [settings, setSettings] = useState<SchedulingSettings>(() => getSchedulingSettings(unit))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function updateSetting<K extends keyof SchedulingSettings>(key: K, value: SchedulingSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    setLoading(true)

    const supabase = createClient()
    const { error: saveError } = await supabase
      .from('units')
      .update({
        timezone,
        business_hours: businessHours,
        scheduling_settings: settings,
      })
      .eq('id', unit.id)

    setLoading(false)

    if (saveError) {
      setError('Não foi possível salvar a configuração de agenda.')
      return
    }

    setSaved(true)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit}>
      <FormSection title="Horário de funcionamento e agenda">
        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <Label htmlFor="timezone">Fuso horário</Label>
          <Select id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500">Todos os horários de agenda desta unidade usam este fuso.</p>
        </div>

        <div className="flex flex-col gap-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <span className="text-sm font-medium text-slate-300">Dias e horários de atendimento</span>
          <WeeklyScheduleEditor value={businessHours} onChange={setBusinessHours} />
        </div>

        <div className="flex flex-col gap-4 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <span className="text-sm font-medium text-slate-300">Regras de agendamento</span>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slotInterval">Intervalo entre slots</Label>
              <Select
                id="slotInterval"
                value={settings.slot_interval_minutes}
                onChange={(e) => updateSetting('slot_interval_minutes', Number(e.target.value))}
              >
                {SLOT_INTERVAL_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m} minutos
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="minNotice">Antecedência mínima (minutos)</Label>
              <Input
                id="minNotice"
                type="number"
                min={0}
                value={settings.min_notice_minutes}
                onChange={(e) => updateSetting('min_notice_minutes', Number(e.target.value))}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="maxAdvance">Horizonte máximo (dias)</Label>
              <Input
                id="maxAdvance"
                type="number"
                min={1}
                value={settings.max_advance_days}
                onChange={(e) => updateSetting('max_advance_days', Number(e.target.value))}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reminderHours">Lembrete — horas antes</Label>
              <Input
                id="reminderHours"
                type="number"
                min={0}
                value={settings.reminder_hours_before}
                onChange={(e) => updateSetting('reminder_hours_before', Number(e.target.value))}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <input
              type="checkbox"
              checked={settings.confirmation_enabled}
              onChange={(e) => updateSetting('confirmation_enabled', e.target.checked)}
              className="accent-cyan-500"
            />
            Enviar confirmação automática ao criar agendamento
          </label>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <input
              type="checkbox"
              checked={settings.reminders_enabled}
              onChange={(e) => updateSetting('reminders_enabled', e.target.checked)}
              className="accent-cyan-500"
            />
            Enviar lembrete automático antes do horário
          </label>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {saved && !error && <p className="text-sm text-emerald-400">Configuração de agenda salva.</p>}

        <button
          type="submit"
          disabled={loading}
          className="self-start rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
        >
          {loading ? 'Salvando...' : 'Salvar configuração de agenda'}
        </button>
      </FormSection>
    </form>
  )
}
