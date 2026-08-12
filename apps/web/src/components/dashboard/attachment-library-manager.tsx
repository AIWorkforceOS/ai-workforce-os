'use client'

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AttachmentKind, EmployeeAttachment } from '@/lib/types'
import {
  FormSection,
  Input,
  Label,
  Select,
  StatusPill,
  TableShell,
  Td,
  Th,
  Textarea,
  Tr,
} from '@/components/ui/dashboard-ui'

const FILE_MAX_BYTES = 15 * 1024 * 1024

const ORG_WIDE_VALUE = ''

/** Funcionários que hoje sabem ler a biblioteca de materiais na conversa (ver relatório da migration 062) — os demais ficam disponíveis para seleção desde já, sem exigir nova migration quando forem conectados. */
export const EMPLOYEE_OPTIONS: { value: string; label: string }[] = [
  { value: 'receptionist', label: 'Recepcionista' },
  { value: 'sdr', label: 'SDR / Vendas' },
  { value: 'recruiter', label: 'Recrutador' },
  { value: 'traffic_specialist', label: 'Tráfego Pago' },
  { value: 'content_specialist', label: 'Conteúdo/Social' },
  { value: 'seo_specialist', label: 'SEO' },
]

function employeeLabel(value: string): string {
  return EMPLOYEE_OPTIONS.find((o) => o.value === value)?.label ?? value
}

function kindLabel(kind: AttachmentKind): string {
  if (kind === 'pdf') return 'PDF'
  if (kind === 'image') return 'Imagem'
  return 'Link'
}

function fileAccept(kind: AttachmentKind): string {
  return kind === 'image' ? 'image/*' : 'application/pdf'
}

type FormState = {
  kind: AttachmentKind
  title: string
  usageInstructions: string
  linkUrl: string
  unitId: string
  employees: string[]
}

function emptyForm(defaultUnitId: string, defaultEmployee: string | null): FormState {
  return {
    kind: 'pdf',
    title: '',
    usageInstructions: '',
    linkUrl: '',
    unitId: defaultUnitId,
    employees: defaultEmployee ? [defaultEmployee] : [],
  }
}

export function AttachmentLibraryManager({
  orgId,
  units,
  initialAttachments,
  defaultUnitId = ORG_WIDE_VALUE,
  defaultEmployee = null,
}: {
  orgId: string
  units: { id: string; name: string }[]
  initialAttachments: EmployeeAttachment[]
  /** Unidade pré-selecionada no formulário de criação (ex.: veio do card de um funcionário específico) — vazio = toda a organização. */
  defaultUnitId?: string
  /** Funcionário pré-marcado no formulário de criação. */
  defaultEmployee?: string | null
}) {
  const [attachments, setAttachments] = useState<EmployeeAttachment[]>(initialAttachments)
  const [form, setForm] = useState<FormState>(emptyForm(defaultUnitId, defaultEmployee))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function unitName(unitId: string | null): string {
    if (!unitId) return 'Toda a organização'
    return units.find((u) => u.id === unitId)?.name ?? 'Unidade removida'
  }

  function resetForm() {
    setForm(emptyForm(defaultUnitId, defaultEmployee))
    setEditingId(null)
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleEdit(attachment: EmployeeAttachment) {
    setEditingId(attachment.id)
    setForm({
      kind: attachment.kind,
      title: attachment.title,
      usageInstructions: attachment.usage_instructions,
      linkUrl: attachment.kind === 'link' ? attachment.file_url : '',
      unitId: attachment.unit_id ?? ORG_WIDE_VALUE,
      employees: attachment.applicable_employees,
    })
    setFile(null)
    setError(null)
  }

  function toggleEmployee(value: string) {
    setForm((f) => ({
      ...f,
      employees: f.employees.includes(value) ? f.employees.filter((e) => e !== value) : [...f.employees, value],
    }))
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    setError(null)
    if (!selected) {
      setFile(null)
      return
    }
    const expectsImage = form.kind === 'image'
    const validType = expectsImage ? selected.type.startsWith('image/') : selected.type === 'application/pdf'
    if (!validType) {
      setError(expectsImage ? 'Envie um arquivo de imagem.' : 'Envie um arquivo PDF.')
      return
    }
    if (selected.size > FILE_MAX_BYTES) {
      setError('O arquivo deve ter no máximo 15MB.')
      return
    }
    setFile(selected)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const title = form.title.trim()
    const usageInstructions = form.usageInstructions.trim()
    if (!title || !usageInstructions) {
      setError('Preencha o título e a instrução de quando usar.')
      return
    }
    if (form.employees.length === 0) {
      setError('Selecione ao menos um funcionário com acesso a este material.')
      return
    }

    const supabase = createClient()
    const editing = editingId ? attachments.find((a) => a.id === editingId) : null
    let fileUrl = form.kind === 'link' ? form.linkUrl.trim() : editing?.file_url ?? ''
    let fileName: string | null = editing?.file_name ?? null

    if (form.kind !== 'link') {
      if (file) {
        setUploading(true)
        const path = `${orgId}/${Date.now()}-${file.name}`
        const { error: uploadError } = await supabase.storage
          .from('employee-attachments')
          .upload(path, file, { upsert: true, contentType: file.type })
        setUploading(false)

        if (uploadError) {
          setError('Não foi possível enviar o arquivo.')
          return
        }

        const { data } = supabase.storage.from('employee-attachments').getPublicUrl(path)
        fileUrl = data.publicUrl
        fileName = file.name
      }
      if (!fileUrl) {
        setError(form.kind === 'image' ? 'Envie um arquivo de imagem.' : 'Envie um arquivo PDF.')
        return
      }
    } else {
      if (!fileUrl) {
        setError('Informe a URL do link.')
        return
      }
      fileName = null
    }

    const payload = {
      kind: form.kind,
      title,
      usage_instructions: usageInstructions,
      file_url: fileUrl,
      file_name: fileName,
      unit_id: form.unitId || null,
      applicable_employees: form.employees,
    }

    if (editingId) {
      const { data, error: saveError } = await supabase
        .from('employee_attachments')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single()
      if (saveError || !data) {
        setError('Não foi possível salvar o material.')
        return
      }
      setAttachments((prev) => prev.map((a) => (a.id === editingId ? (data as EmployeeAttachment) : a)))
      resetForm()
      return
    }

    const { data, error: insertError } = await supabase
      .from('employee_attachments')
      .insert({ ...payload, org_id: orgId })
      .select()
      .single()

    if (insertError || !data) {
      setError('Não foi possível criar o material.')
      return
    }

    setAttachments((prev) => [data as EmployeeAttachment, ...prev])
    resetForm()
  }

  async function handleToggleActive(attachment: EmployeeAttachment) {
    const supabase = createClient()
    const { data, error: toggleError } = await supabase
      .from('employee_attachments')
      .update({ is_active: !attachment.is_active })
      .eq('id', attachment.id)
      .select()
      .single()

    if (toggleError || !data) return
    setAttachments((prev) => prev.map((a) => (a.id === attachment.id ? (data as EmployeeAttachment) : a)))
  }

  async function handleDelete(attachment: EmployeeAttachment) {
    if (!window.confirm(`Excluir "${attachment.title}"?`)) return
    const supabase = createClient()
    const { error: deleteError } = await supabase.from('employee_attachments').delete().eq('id', attachment.id)
    if (deleteError) return
    setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))
    if (editingId === attachment.id) resetForm()
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit}>
        <FormSection title={editingId ? 'Editar material' : 'Novo material'}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attachmentKind">Tipo</Label>
              <Select
                id="attachmentKind"
                value={form.kind}
                onChange={(e) => {
                  setFile(null)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                  setForm((f) => ({ ...f, kind: e.target.value as AttachmentKind }))
                }}
                disabled={!!editingId}
              >
                <option value="pdf">PDF (upload)</option>
                <option value="image">Imagem (upload)</option>
                <option value="link">Link</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attachmentTitle">Título *</Label>
              <Input
                id="attachmentTitle"
                required
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Tabela de preços"
              />
            </div>
          </div>

          {form.kind === 'link' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attachmentLink">URL do link *</Label>
              <Input
                id="attachmentLink"
                type="url"
                required
                value={form.linkUrl}
                onChange={(e) => setForm((f) => ({ ...f, linkUrl: e.target.value }))}
                placeholder="https://..."
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attachmentFile">
                Arquivo {form.kind === 'image' ? 'de imagem' : 'PDF'} {editingId ? '(deixe em branco para manter o atual)' : '*'}
              </Label>
              <input
                id="attachmentFile"
                ref={fileInputRef}
                type="file"
                accept={fileAccept(form.kind)}
                onChange={handleFileChange}
                className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-200"
              />
              {file && <p className="text-xs text-slate-400">{file.name}</p>}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attachmentUnit">Vale para</Label>
              <Select
                id="attachmentUnit"
                value={form.unitId}
                onChange={(e) => setForm((f) => ({ ...f, unitId: e.target.value }))}
              >
                <option value={ORG_WIDE_VALUE}>Toda a organização</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    Só a unidade {u.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Funcionários com acesso *</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {EMPLOYEE_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-1.5 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.employees.includes(option.value)}
                    onChange={() => toggleEmployee(option.value)}
                    className="h-3.5 w-3.5 rounded border-white/20 bg-white/10"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="attachmentInstructions">Quando usar (isto é o treinamento) *</Label>
            <Textarea
              id="attachmentInstructions"
              required
              rows={3}
              value={form.usageInstructions}
              onChange={(e) => setForm((f) => ({ ...f, usageInstructions: e.target.value }))}
              placeholder="Ex: envie este PDF quando o cliente perguntar sobre preços"
            />
            <p className="text-[11px] leading-snug text-slate-500">
              Cada funcionário selecionado acima lê esta instrução para decidir sozinho, durante a conversa, se e
              quando enviar este material — nunca envia por padrão nem repete sem necessidade.
            </p>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={uploading}
              className="self-start rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
            >
              {uploading ? 'Enviando...' : editingId ? 'Salvar alterações' : 'Adicionar material'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Cancelar
              </button>
            )}
          </div>
        </FormSection>
      </form>

      {attachments.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-[#141a2b]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableShell>
                <Th>Título</Th>
                <Th>Tipo</Th>
                <Th>Vale para</Th>
                <Th>Funcionários</Th>
                <Th>Quando usar</Th>
                <Th>Status</Th>
                <Th>Ações</Th>
              </TableShell>
              <tbody>
                {attachments.map((attachment) => (
                  <Tr key={attachment.id}>
                    <Td className="font-semibold text-white">{attachment.title}</Td>
                    <Td className="text-slate-400">{kindLabel(attachment.kind)}</Td>
                    <Td className="text-slate-400">{unitName(attachment.unit_id)}</Td>
                    <Td className="max-w-[14rem] text-slate-400">
                      {attachment.applicable_employees.map(employeeLabel).join(', ')}
                    </Td>
                    <Td className="max-w-xs text-slate-400">
                      <span className="line-clamp-2">{attachment.usage_instructions}</span>
                    </Td>
                    <Td>
                      <button type="button" onClick={() => handleToggleActive(attachment)}>
                        <StatusPill variant={attachment.is_active ? 'green' : 'slate'}>
                          {attachment.is_active ? 'Ativo' : 'Inativo'}
                        </StatusPill>
                      </button>
                    </Td>
                    <Td>
                      <div className="flex gap-3 text-xs font-semibold">
                        <button type="button" className="text-cyan-400 hover:text-cyan-300" onClick={() => handleEdit(attachment)}>
                          Editar
                        </button>
                        <button type="button" className="text-red-400 hover:text-red-300" onClick={() => handleDelete(attachment)}>
                          Excluir
                        </button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
