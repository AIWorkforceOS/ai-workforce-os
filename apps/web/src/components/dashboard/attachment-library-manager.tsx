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

const PDF_MAX_BYTES = 15 * 1024 * 1024

type FormState = {
  kind: AttachmentKind
  title: string
  usageInstructions: string
  linkUrl: string
}

const EMPTY_FORM: FormState = { kind: 'pdf', title: '', usageInstructions: '', linkUrl: '' }

export function AttachmentLibraryManager({
  unitId,
  orgId,
  agentType,
  personaName,
  initialAttachments,
}: {
  unitId: string
  orgId: string
  agentType: string
  personaName: string
  initialAttachments: EmployeeAttachment[]
}) {
  const [attachments, setAttachments] = useState<EmployeeAttachment[]>(initialAttachments)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function resetForm() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setPdfFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleEdit(attachment: EmployeeAttachment) {
    setEditingId(attachment.id)
    setForm({
      kind: attachment.kind,
      title: attachment.title,
      usageInstructions: attachment.usage_instructions,
      linkUrl: attachment.kind === 'link' ? attachment.file_url : '',
    })
    setPdfFile(null)
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setError(null)
    if (!file) {
      setPdfFile(null)
      return
    }
    if (file.type !== 'application/pdf') {
      setError('Envie um arquivo PDF.')
      return
    }
    if (file.size > PDF_MAX_BYTES) {
      setError('O PDF deve ter no máximo 15MB.')
      return
    }
    setPdfFile(file)
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

    const supabase = createClient()
    let fileUrl = form.kind === 'link' ? form.linkUrl.trim() : editingId ? attachments.find((a) => a.id === editingId)?.file_url ?? '' : ''
    let fileName: string | null = editingId ? attachments.find((a) => a.id === editingId)?.file_name ?? null : null

    if (form.kind === 'pdf') {
      if (pdfFile) {
        setUploading(true)
        const path = `${unitId}/${Date.now()}-${pdfFile.name}`
        const { error: uploadError } = await supabase.storage
          .from('employee-attachments')
          .upload(path, pdfFile, { upsert: true, contentType: 'application/pdf' })
        setUploading(false)

        if (uploadError) {
          setError('Não foi possível enviar o PDF.')
          return
        }

        const { data } = supabase.storage.from('employee-attachments').getPublicUrl(path)
        fileUrl = data.publicUrl
        fileName = pdfFile.name
      }
      if (!fileUrl) {
        setError('Envie um arquivo PDF.')
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
    }

    if (editingId) {
      const { data, error: saveError } = await supabase
        .from('employee_attachments')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single()
      if (saveError || !data) {
        setError('Não foi possível salvar o anexo.')
        return
      }
      setAttachments((prev) => prev.map((a) => (a.id === editingId ? (data as EmployeeAttachment) : a)))
      resetForm()
      return
    }

    const { data, error: insertError } = await supabase
      .from('employee_attachments')
      .insert({ ...payload, org_id: orgId, unit_id: unitId, agent_type: agentType })
      .select()
      .single()

    if (insertError || !data) {
      setError('Não foi possível criar o anexo.')
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
        <FormSection title={editingId ? 'Editar anexo' : 'Novo anexo'}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attachmentKind">Tipo</Label>
              <Select
                id="attachmentKind"
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as AttachmentKind }))}
                disabled={!!editingId}
              >
                <option value="pdf">PDF (upload)</option>
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

          {form.kind === 'pdf' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attachmentFile">Arquivo PDF {editingId ? '(deixe em branco para manter o atual)' : '*'}</Label>
              <input
                id="attachmentFile"
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handleFileChange}
                className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-200"
              />
              {pdfFile && <p className="text-xs text-slate-400">{pdfFile.name}</p>}
            </div>
          ) : (
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
          )}

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
              {personaName} lê esta instrução para decidir sozinho(a), durante a conversa, se e quando enviar este material — sem enviar por padrão nem repetir sem necessidade.
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
              {uploading ? 'Enviando...' : editingId ? 'Salvar alterações' : 'Adicionar anexo'}
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
                <Th>Quando usar</Th>
                <Th>Status</Th>
                <Th>Ações</Th>
              </TableShell>
              <tbody>
                {attachments.map((attachment) => (
                  <Tr key={attachment.id}>
                    <Td className="font-semibold text-white">{attachment.title}</Td>
                    <Td className="text-slate-400">{attachment.kind === 'pdf' ? 'PDF' : 'Link'}</Td>
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
