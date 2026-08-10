'use client'

import { useState, type ChangeEvent } from 'react'
import { AlertTriangle, CheckCircle2, FileText, Loader2, Sparkles, Trash2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isExtractableAttachment, type ServiceOrderExtraction } from '@/lib/service-orders/extraction'
import {
  buildBulkAppointmentInsertRows,
  customerNameForRow,
  extractionToRow,
  validateRowsForCreate,
  type BulkOrderRow,
} from '@/lib/service-orders/bulk-import'
import { Card, Input, Label, Select } from '@/components/ui/dashboard-ui'
import type { Employee, Service } from '@/lib/types'

const FILE_MAX_BYTES = 15 * 1024 * 1024
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

/** Fire-and-forget: a mutação em `appointments` já foi gravada, o aviso automático nunca deve bloquear a UI nem virar erro pro usuário. */
function notifyAppointment(unitId: string, appointmentId: string) {
  void fetch(`/api/units/${unitId}/appointments/${appointmentId}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'booked' }),
  }).catch(() => {})
}

/**
 * Importação em lote de ordens de serviço da contratante (ex.: 360) —
 * o admin recebe várias ordens no mesmo dia (um PDF/foto por
 * loja/atendimento) e anexa todas de uma vez. Cada arquivo passa pela
 * mesma extração por IA do fluxo de anexo único
 * (lib/service-orders/extraction.ts via a rota /service-order/extract,
 * que já não depende de um agendamento existir), sequencialmente pra
 * dar feedback de progresso sem sobrecarregar a API de visão. Depois de
 * extraídas, o admin só escolhe manualmente, por ordem, o profissional
 * e o horário — todo o resto (número, endereço, loja, IVR, prioridade,
 * tipo, emissor, escopo PT+EN) já vem preenchido. Uma ordem que falhar
 * na extração nunca trava as outras: a linha aparece em branco pra
 * preenchimento manual (ver extractionToRow).
 */
export function BulkServiceOrderImportModal({
  unitId,
  orgId,
  timezone,
  services,
  employees,
  initialDate,
  onClose,
  onSaved,
}: {
  unitId: string
  orgId: string
  timezone: string
  services: Service[]
  employees: Employee[]
  initialDate: string
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [rows, setRows] = useState<BulkOrderRow[]>([])

  const [date, setDate] = useState(initialDate)
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '')

  const [creating, setCreating] = useState(false)
  const [createErrors, setCreateErrors] = useState<string[]>([])
  const [createdCount, setCreatedCount] = useState<number | null>(null)

  const selectedService = services.find((s) => s.id === serviceId) ?? null

  function handleFilesChange(event: ChangeEvent<HTMLInputElement>) {
    setFileError(null)
    const files = Array.from(event.target.files ?? [])
    const invalid = files.find((f) => !ACCEPTED_TYPES.includes(f.type) || f.size > FILE_MAX_BYTES)
    if (invalid) {
      setFileError(`"${invalid.name}" não é um PDF/imagem válido ou passa de 15MB — remova esse arquivo e tente de novo.`)
      setPendingFiles([])
      return
    }
    setPendingFiles(files)
  }

  /**
   * Sobe e extrai cada arquivo, um de cada vez (feedback de progresso
   * simples e sem sobrecarregar a extração por IA) — reaproveita
   * exatamente o path "pending" e a rota de extração já usados pelo
   * anexo inline em AppointmentFormModal, então nenhuma rota nova é
   * necessária. Qualquer falha (upload ou extração) numa ordem específica
   * vira uma linha em branco, nunca interrompe as demais.
   */
  async function handleProcessFiles() {
    if (pendingFiles.length === 0) return
    setProcessing(true)
    setProgress({ done: 0, total: pendingFiles.length })
    const supabase = createClient()
    const built: BulkOrderRow[] = []

    for (const file of pendingFiles) {
      const rowId = crypto.randomUUID()
      let fileUrl = ''
      let extraction: (ServiceOrderExtraction & { failed?: boolean }) | null = null

      try {
        const path = `${unitId}/pending-${crypto.randomUUID()}/${file.name}`
        const { error: uploadError } = await supabase.storage
          .from('service-orders')
          .upload(path, file, { contentType: file.type, upsert: true })
        if (uploadError) throw uploadError
        const { data: publicUrlData } = supabase.storage.from('service-orders').getPublicUrl(path)
        fileUrl = publicUrlData.publicUrl

        if (isExtractableAttachment(file.name)) {
          const response = await fetch(`/api/units/${unitId}/service-order/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileUrl, fileName: file.name }),
          })
          if (response.ok) {
            extraction = await response.json()
          }
        }
      } catch {
        // upload ou extração falhou — a linha ainda entra na lista, com o que conseguiu (fileUrl pode ficar vazio).
      }

      built.push(extractionToRow(rowId, file.name, fileUrl, extraction))
      setProgress((prev) => (prev ? { done: prev.done + 1, total: prev.total } : prev))
    }

    setRows(built)
    setPendingFiles([])
    setProcessing(false)
    setProgress(null)
  }

  function updateRow(id: string, patch: Partial<BulkOrderRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  /**
   * Resolve o cliente/local de cada linha: reaproveita um cadastro já
   * existente com o mesmo nome nesta unidade (lojas recorrentes recebem
   * novas ordens periodicamente) ou cadastra um novo — nunca pede pro
   * admin buscar/escolher cliente manualmente, é a loja da ordem.
   */
  async function resolveCustomerIds(
    supabase: ReturnType<typeof createClient>,
    rowsToCreate: BulkOrderRow[]
  ): Promise<Record<string, string>> {
    const customerIdByRowId: Record<string, string> = {}
    for (const row of rowsToCreate) {
      const name = customerNameForRow(row)
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('unit_id', unitId)
        .eq('name', name)
        .limit(1)
        .maybeSingle()
      if (existing) {
        customerIdByRowId[row.id] = (existing as { id: string }).id
        continue
      }
      const { data: created, error: createError } = await supabase
        .from('customers')
        .insert({
          org_id: orgId,
          unit_id: unitId,
          name,
          phone: row.locationPhone.trim() || null,
          address: row.address.trim() || null,
          source: 'service_order_bulk_import',
        })
        .select('id')
        .single()
      if (createError || !created) {
        throw new Error(`Não foi possível cadastrar o cliente/local de "${row.fileName}".`)
      }
      customerIdByRowId[row.id] = (created as { id: string }).id
    }
    return customerIdByRowId
  }

  async function handleCreateAll() {
    setCreateErrors([])
    setCreatedCount(null)

    const validationErrors = validateRowsForCreate(rows)
    if (validationErrors.length > 0) {
      setCreateErrors(validationErrors.map((e) => e.message))
      return
    }
    if (rows.length === 0) {
      setCreateErrors(['Processe ao menos uma ordem antes de criar os agendamentos.'])
      return
    }

    setCreating(true)
    const supabase = createClient()
    try {
      const customerIdByRowId = await resolveCustomerIds(supabase, rows)
      const insertRows = buildBulkAppointmentInsertRows({
        rows,
        customerIdByRowId,
        date,
        timezone,
        durationMinutes: selectedService?.duration_minutes ?? 120,
        orgId,
        unitId,
        serviceId: serviceId || null,
      })
      const { data: inserted, error: insertError } = await supabase
        .from('appointments')
        .insert(insertRows)
        .select('id')
      if (insertError) throw insertError

      for (const row of (inserted ?? []) as { id: string }[]) {
        notifyAppointment(unitId, row.id)
      }
      setCreatedCount(insertRows.length)
      await onSaved()
    } catch (error) {
      setCreateErrors([error instanceof Error ? error.message : 'Não foi possível criar os agendamentos. Tente novamente.'])
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <Card className="w-full max-w-3xl p-6">
        <div onClick={(e) => e.stopPropagation()} className="max-h-[85vh] overflow-y-auto">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-white">Anexar ordens do dia</h2>
              <p className="text-xs text-slate-400">
                Envie todas as ordens de serviço recebidas de uma vez — a IA extrai os dados de cada uma, você só escolhe o
                profissional e o horário.
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">
              <X size={16} />
            </button>
          </div>

          {createdCount !== null ? (
            <div className="flex flex-col gap-4">
              <div
                className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-emerald-300"
                style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)' }}
              >
                <CheckCircle2 size={16} />
                {createdCount} agendamento{createdCount === 1 ? '' : 's'} criado{createdCount === 1 ? '' : 's'} com sucesso.
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-fit rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
              >
                Fechar
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Data dos agendamentos *</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Serviço (define a duração) *</Label>
                  <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.duration_minutes}min)
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              {rows.length === 0 && (
                <div className="flex flex-col gap-2.5 rounded-xl px-3.5 py-3" style={{ background: 'rgba(129,140,248,0.06)', border: '1px solid rgba(129,140,248,0.2)' }}>
                  <Label>Arquivos das ordens (PDF ou foto, um por atendimento)</Label>
                  <input
                    type="file"
                    multiple
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={handleFilesChange}
                    className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-200"
                  />
                  {fileError && <p className="text-xs text-red-400">{fileError}</p>}
                  {pendingFiles.length > 0 && !processing && (
                    <button
                      type="button"
                      onClick={handleProcessFiles}
                      className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                      style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
                    >
                      <Sparkles size={13} />
                      Processar {pendingFiles.length} ordem{pendingFiles.length === 1 ? '' : 's'} com IA
                    </button>
                  )}
                  {processing && progress && (
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
                      <Loader2 size={13} className="animate-spin" />
                      Processando ordem {progress.done + 1} de {progress.total}…
                    </p>
                  )}
                </div>
              )}

              {rows.length > 0 && (
                <div className="flex flex-col gap-3">
                  {rows.map((row) => (
                    <div key={row.id} className="flex flex-col gap-2.5 rounded-xl px-3.5 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                          <FileText size={13} className="text-cyan-400" />
                          {row.fileName}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-red-400"
                        >
                          <Trash2 size={12} />
                          Remover
                        </button>
                      </div>

                      {row.extractionFailed && (
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                          <AlertTriangle size={12} />
                          Não consegui ler esse documento automaticamente — os campos abaixo não são exibidos, mas a ordem
                          original continua anexada; complete profissional e horário e ajuste os demais dados depois pela
                          agenda.
                        </p>
                      )}

                      {!row.extractionFailed && (
                        <div className="flex flex-col gap-1 text-xs text-slate-400">
                          <p>
                            {row.orderNumber ? `Nº ${row.orderNumber}` : 'Sem número identificado'}
                            {row.locationName ? ` · ${row.locationName}` : ''}
                          </p>
                          {row.address && <p className="text-slate-500">{row.address}</p>}
                          {row.summaryPt && <p className="line-clamp-2 text-slate-500">{row.summaryPt}</p>}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                          <Label>Profissional *</Label>
                          <Select value={row.employeeId} onChange={(e) => updateRow(row.id, { employeeId: e.target.value })} required>
                            <option value="">Escolha…</option>
                            {employees.map((emp) => (
                              <option key={emp.id} value={emp.id}>
                                {emp.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>Horário *</Label>
                          <Input type="time" value={row.time} onChange={(e) => updateRow(row.id, { time: e.target.value })} required />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {createErrors.length > 0 && (
                <div className="flex flex-col gap-1 rounded-xl px-3.5 py-2.5" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                  {createErrors.map((msg, i) => (
                    <p key={i} className="text-xs font-semibold text-red-400">
                      {msg}
                    </p>
                  ))}
                </div>
              )}

              <div className="flex gap-3">
                {rows.length > 0 && (
                  <button
                    type="button"
                    disabled={creating}
                    onClick={handleCreateAll}
                    className="flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
                  >
                    {creating ? 'Criando…' : `Criar ${rows.length} agendamento${rows.length === 1 ? '' : 's'}`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5"
                  style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
