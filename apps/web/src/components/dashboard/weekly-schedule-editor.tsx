'use client'

import type { TimeInterval, Weekday, WeeklySchedule } from '@/lib/types'
import { Input } from '@/components/ui/dashboard-ui'

const WEEKDAYS: { key: Weekday; label: string }[] = [
  { key: 'mon', label: 'Segunda' },
  { key: 'tue', label: 'Terça' },
  { key: 'wed', label: 'Quarta' },
  { key: 'thu', label: 'Quinta' },
  { key: 'fri', label: 'Sexta' },
  { key: 'sat', label: 'Sábado' },
  { key: 'sun', label: 'Domingo' },
]

const DEFAULT_INTERVAL: TimeInterval = { start: '09:00', end: '18:00' }

/**
 * Grade semanal simplificada: um único intervalo por dia (sem turnos
 * partidos). Decisão conservadora da sub-etapa 2/7 — o tipo WeeklySchedule
 * suporta múltiplos intervalos, mas a UI não expõe isso ainda.
 */
export function WeeklyScheduleEditor({
  value,
  onChange,
}: {
  value: WeeklySchedule
  onChange: (next: WeeklySchedule) => void
}) {
  function toggleDay(day: Weekday, open: boolean) {
    const next = { ...value }
    if (open) {
      next[day] = [DEFAULT_INTERVAL]
    } else {
      delete next[day]
    }
    onChange(next)
  }

  function updateInterval(day: Weekday, field: keyof TimeInterval, time: string) {
    const current = value[day]?.[0] ?? DEFAULT_INTERVAL
    onChange({ ...value, [day]: [{ ...current, [field]: time }] })
  }

  return (
    <div className="flex flex-col gap-2">
      {WEEKDAYS.map(({ key, label }) => {
        const interval = value[key]?.[0]
        const open = !!interval
        return (
          <div key={key} className="flex flex-wrap items-center gap-3">
            <label className="flex w-28 flex-shrink-0 items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={open}
                onChange={(e) => toggleDay(key, e.target.checked)}
                className="accent-cyan-500"
              />
              {label}
            </label>
            {interval ? (
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={interval.start}
                  onChange={(e) => updateInterval(key, 'start', e.target.value)}
                  className="w-28"
                />
                <span className="text-xs text-slate-500">até</span>
                <Input
                  type="time"
                  value={interval.end}
                  onChange={(e) => updateInterval(key, 'end', e.target.value)}
                  className="w-28"
                />
              </div>
            ) : (
              <span className="text-xs text-slate-500">Fechado</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
