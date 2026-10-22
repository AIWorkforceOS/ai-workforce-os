'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Paperclip, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatBytes, LEAD_ATTACHMENT_ACCEPT, leadAttachmentPath, validateAttachmentFile } from '@/lib/crm/attachments'

type Attachment = { id: string; storage_path: string; file_name: string; content_type: string | null; size_bytes: number | null; created_at: string }

const BUCKET = 'lead-attachments'

/** Anexos do lead (propostas, contratos, prints). Bucket privado: o arquivo abre por link assinado de 60 segundos. */
export function LeadAttachments({ leadId, unitId, currentUserId, onChanged }: { leadId: string; unitId: string; currentUserId: string | null; onChanged: () => void }) {
  const [items, setItems] = useState<Attachment[]>([])
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().from('lead_attachments').select('id, storage_path, file_name, content_type, size_bytes, created_at').eq('lead_id', leadId).order('created_at', { ascending: false })
    if (err) return setUnavailable(true)
    setUnavailable(false)
    setItems((data ?? []) as Attachment[])
  }, [leadId])

  useEffect(() => {
    void load()
  }, [load])

  async function upload(files: File[]) {
    if (files.length === 0 || busy) return
    setError(null)
    const problems = files.map(validateAttachmentFile).filter((p): p is string => Boolean(p))
    if (problems.length > 0) return setError(problems[0]!)
    setBusy(true)
    const supabase = createClient()
    const failed: string[] = []
    for (const file of files) {
      const path = leadAttachmentPath(unitId, leadId, crypto.randomUUID(), file.name)
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
      if (up.error) {
        failed.push(file.name)
        continue
      }
      const ins = await supabase.from('lead_attachments').insert({ unit_id: unitId, lead_id: leadId, storage_path: path, file_name: file.name.slice(0, 200), content_type: file.type, size_bytes: file.size, uploaded_by: currentUserId })
      if (ins.error) {
        await supabase.storage.from(BUCKET).remove([path]) // não deixa arquivo órfão sem registro
        failed.push(file.name)
        continue
      }
      // linha do tempo do lead (silencioso se falhar)
      await supabase.from('lead_activities').insert({ unit_id: unitId, lead_id: leadId, kind: 'note', body: `Arquivo anexado: ${file.name}`.slice(0, 2000), created_by: currentUserId })
    }
    setBusy(false)
    if (input.current) input.current.value = ''
    if (failed.length > 0) setError(`Não foi possível enviar: ${failed.join(', ')}.`)
    await load()
    onChanged()
  }

  async function open(item: Attachment) {
    setError(null)
    const { data, error: err } = await createClient().storage.from(BUCKET).createSignedUrl(item.storage_path, 60)
    if (err || !data?.signedUrl) return setError('Não foi possível abrir o arquivo.')
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function remove(item: Attachment) {
    if (!window.confirm(`Excluir "${item.file_name}"?`)) return
    setError(null)
    const supabase = createClient()
    const del = await supabase.from('lead_attachments').delete().eq('id', item.id)
    if (del.error) return setError('Não foi possível excluir.')
    await supabase.storage.from(BUCKET).remove([item.storage_path])
    await load()
  }

  if (unavailable) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Anexos{items.length > 0 ? ` (${items.length})` : ''}</p>
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold text-cyan-300 hover:text-cyan-200 disabled:opacity-50" style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.25)' }}>
          <Paperclip size={12} />
          {busy ? 'Enviando…' : 'Anexar arquivo'}
        </button>
        <input ref={input} type="file" multiple accept={LEAD_ATTACHMENT_ACCEPT} className="hidden" onChange={(e) => void upload(Array.from(e.target.files ?? []))} />
      </div>
      {items.length === 0 && <p className="text-xs text-slate-500">Nenhum arquivo anexado. PDF, imagem, Word, Excel, CSV ou TXT até 15MB.</p>}
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <FileText size={14} className="shrink-0 text-slate-400" />
          <button type="button" onClick={() => void open(item)} className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-slate-200 hover:text-cyan-300">
            {item.file_name}
            <span className="ml-1.5 font-normal text-slate-500">{formatBytes(item.size_bytes)}</span>
          </button>
          <button type="button" onClick={() => void remove(item)} aria-label={`Excluir ${item.file_name}`} className="rounded-md p-1 text-slate-500 hover:bg-white/10 hover:text-red-400">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
