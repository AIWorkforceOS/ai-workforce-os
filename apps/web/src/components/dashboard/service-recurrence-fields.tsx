'use client'

import { Label, Select } from '@/components/ui/dashboard-ui'
import { WEEKDAY_ORDER } from '@/lib/scheduling/recurrence'
import type { ServiceRecurrence, ServiceRecurrenceType } from '@/lib/scheduling/service-recurrence'
import type { Weekday } from '@/lib/types'

const TYPE_OPTIONS: { value: ServiceRecurrenceType; label: string }[] = [
  { value: 'once', label: 'Serviço único' },
  { value: 'weekly', label: 'Recorrente — toda semana' },
  { value: 'biweekly', label: 'Recorrente — a cada 15 dias' },
  { value: 'monthly', label: 'Recorrente — todo mês' },
  { value: 'custom', label: 'Recorrente — personalizado (2+ vezes por semana)' },
]

const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: 'Seg',
  tue: 'Ter',
  wed: 'Qua',
  thu: 'Qui',
  fri: 'Sex',
  sat: 'Sáb',
  sun: 'Dom',
}

/**
 * Seletor de recorrência do serviço contratado (cadastro/ficha do
 * cliente, modo gestão completa) — usado como valor padrão ao agendar.
 * Mesmo vocabulário do agendamento em si (lib/scheduling/recurrence),
 * guardado em customers.custom_fields.service_recurrence.
 */
export function ServiceRecurrenceFields({
  value,
  onChange,
}: {
  value: ServiceRecurrence
  onChange: (next: ServiceRecurrence) => void
}) {
  const days = value.days ?? []

  function toggleDay(day: Weekday) {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day]
    onChange({ type: 'custom', days: next })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Recorrência</Label>
      <Select
        value={value.type}
        onChange={(e) => {
          const type = e.target.value as ServiceRecurrenceType
          onChange(type === 'custom' ? { type, days: days.length > 0 ? days : ['mon'] } : { type })
        }}
      >
        {TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>

      {value.type === 'custom' && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {WEEKDAY_ORDER.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className="rounded-lg px-2.5 py-1 text-xs font-bold transition-colors"
              style={
                days.includes(day)
                  ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: 'white' }
                  : { background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.08)' }
              }
            >
              {WEEKDAY_LABEL[day]}
            </button>
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        Esses dados viram o padrão ao agendar: valor pré-preenchido e, se recorrente, a agenda já sugere repetir.
      </p>
    </div>
  )
}
