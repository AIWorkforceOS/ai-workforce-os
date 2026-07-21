'use client'

import { Fragment, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Employee, WeeklySchedule } from '@/lib/types'
import { Card, EmptyState, TableShell, Td, Th, Tr } from '@/components/ui/dashboard-ui'
import { WeeklyScheduleEditor } from '@/components/dashboard/weekly-schedule-editor'
import { Users } from 'lucide-react'

export function EmployeeSchedulingPanel({ initialEmployees }: { initialEmployees: Employee[] }) {
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [draftAvailability, setDraftAvailability] = useState<WeeklySchedule>({})
  const [saving, setSaving] = useState(false)

  async function handleToggleSchedulable(employee: Employee) {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('employees')
      .update({ is_schedulable: !employee.is_schedulable })
      .eq('id', employee.id)
      .select()
      .single()

    if (error || !data) return
    setEmployees((prev) => prev.map((e) => (e.id === employee.id ? (data as Employee) : e)))
  }

  function handleExpand(employee: Employee) {
    if (expandedId === employee.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(employee.id)
    setDraftAvailability(employee.availability ?? {})
  }

  async function handleSaveAvailability(employee: Employee) {
    setSaving(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('employees')
      .update({ availability: draftAvailability })
      .eq('id', employee.id)
      .select()
      .single()
    setSaving(false)

    if (error || !data) return
    setEmployees((prev) => prev.map((e) => (e.id === employee.id ? (data as Employee) : e)))
    setExpandedId(null)
  }

  if (employees.length === 0) {
    return (
      <Card className="overflow-hidden">
        <EmptyState
          icon={<Users size={22} className="text-white" />}
          title="Nenhum funcionário cadastrado nesta unidade"
          subtitle="Cadastre colaboradores para poder marcá-los como profissionais de agenda."
        />
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <TableShell>
            <Th>Nome</Th>
            <Th>Cargo</Th>
            <Th>Atende agenda</Th>
            <Th>Disponibilidade</Th>
          </TableShell>
          <tbody>
            {employees.map((employee) => (
              <Fragment key={employee.id}>
                <Tr>
                  <Td className="font-semibold text-white">{employee.name}</Td>
                  <Td className="text-slate-400 capitalize">{employee.role}</Td>
                  <Td>
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={employee.is_schedulable}
                        onChange={() => handleToggleSchedulable(employee)}
                        className="accent-cyan-500"
                      />
                      {employee.is_schedulable ? 'Sim' : 'Não'}
                    </label>
                  </Td>
                  <Td>
                    {employee.is_schedulable ? (
                      <button
                        type="button"
                        className="text-xs font-semibold text-cyan-400 hover:text-cyan-300"
                        onClick={() => handleExpand(employee)}
                      >
                        {expandedId === employee.id ? 'Fechar' : 'Configurar horários'}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500">Ative &quot;Atende agenda&quot; primeiro</span>
                    )}
                  </Td>
                </Tr>
                {expandedId === employee.id && (
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td colSpan={4} className="px-5 py-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <p className="mb-3 text-xs text-slate-500">
                        Vazio = segue o horário de funcionamento da unidade.
                      </p>
                      <WeeklyScheduleEditor value={draftAvailability} onChange={setDraftAvailability} />
                      <div className="mt-4 flex gap-3">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleSaveAvailability(employee)}
                          className="rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
                        >
                          {saving ? 'Salvando...' : 'Salvar disponibilidade'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedId(null)}
                          className="rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
                          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                        >
                          Cancelar
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
