'use client'

import { Input, Label, Select, Textarea } from '@/components/ui/dashboard-ui'
import type { DynamicField } from '@/lib/verticals/catalog'

/**
 * Renderiza um formulário a partir de um DynamicField[] (ver
 * lib/verticals/catalog.ts) — só UI, sem persistência própria. O chamador
 * guarda `values` no próprio estado e recebe as mudanças via `onChange`.
 */
export function DynamicFieldsForm({
  fields,
  values,
  onChange,
}: {
  fields: DynamicField[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}) {
  if (fields.length === 0) return null

  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1.5">
          {field.type !== 'boolean' && (
            <Label>
              {field.label}
              {field.required ? ' *' : ''}
            </Label>
          )}
          {renderField(field, values[field.key], (value) => onChange(field.key, value))}
        </div>
      ))}
    </div>
  )
}

function renderField(field: DynamicField, value: unknown, setValue: (value: unknown) => void) {
  switch (field.type) {
    case 'number':
      return (
        <Input
          type="number"
          required={field.required}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => setValue(e.target.value === '' ? null : Number(e.target.value))}
        />
      )
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => setValue(e.target.checked)}
            className="accent-cyan-500"
          />
          {field.label}
        </label>
      )
    case 'select':
      return (
        <Select required={field.required} value={typeof value === 'string' ? value : ''} onChange={(e) => setValue(e.target.value || null)}>
          <option value="">—</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      )
    case 'textarea':
      return (
        <Textarea
          rows={3}
          required={field.required}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => setValue(e.target.value)}
        />
      )
    case 'text':
    default:
      return (
        <Input
          required={field.required}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => setValue(e.target.value)}
        />
      )
  }
}
