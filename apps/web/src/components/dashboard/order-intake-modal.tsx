'use client'

import { useEffect, useState, type ChangeEvent } from 'react'
import { CheckCircle2, Loader2, Sparkles, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, Input, Label, Select, Textarea } from '@/components/ui/dashboard-ui'
import { resolveClientCustomerId } from '@/lib/clients/link-client'
import { buildIntakeAppointmentRow, emptyIntakeForm, validateIntake, type IntakeForm } from '@/lib/service-orders/intake-order'
import type { OrderAnalysis } from '@/lib/service-orders/demand-analysis'
import type { ServiceOrderExtraction } from '@/lib/service-orders/extraction'

const FILE_MAX_BYTES = 15 * 1024 * 1024
const PHOTO_MAX_BYTES = 10 * 1024 * 1024
const MAX_PHOTOS = 10
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

type AnalyzeResponse = { extraction: ServiceOrderExtraction | null; analysis: OrderAnalysis | null; failed: boolean; fileReadFailed: boolean }

/**
 * "Anexar ordem": o administrador baixa o PDF (ou copia a descrição) da ordem recebida, escolhe o cliente, anexa o arquivo e/ou cola a descrição
 * (e fotos, se houver) e a ordem entra na Agenda sem técnico. A IA (só ao clicar em "Analisar com IA") lê o texto e diz qual é a demanda,
 * o que provavelmente precisa de material e uma ideia do escopo — apoio interno, o administrador revisa tudo antes de criar.
 */
export function OrderIntakeModal({ unitId, orgId, timezone, initialDate, onClose, onSaved }: { unitId: string; orgId: string; timezone: string; initialDate: string; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [form, setForm] = useState<IntakeForm>(() => emptyIntakeForm(initialDate))
  const [clients, setClients] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  const set = <K extends keyof IntakeForm>(key: K, value: IntakeForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  useEffect(() => {
    let cancelled = false
    void fetch('/api/client-profiles')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { profiles?: { name: string }[] } | null) => {
        if (cancelled || !data?.profiles) return
        const names = data.profiles.map((p) => p.name)
        setClients(names)
        setForm((f) => (f.clientName || names.length !== 1 ? f : { ...f, clientName: names[0]! }))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  async function upload(file: File): Promise<string | null> {
    const supabase = createClient()
    const path = `${unitId}/pending-${crypto.randomUUID()}/${file.name.replace(/[^\w.\-]+/g, '_')}`
    const { error: upErr } = await supabase.storage.from('service-orders').upload(path, file, { contentType: file.type, upsert: true })
    if (upErr) return null
    return supabase.storage.from('service-orders').getPublicUrl(path).data.publicUrl
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!FILE_TYPES.includes(file.type)) return setError('Envie um PDF ou uma imagem (JPG, PNG, WEBP).')
    if (file.size > FILE_MAX_BYTES) return setError('O arquivo deve ter no máximo 15MB.')
    setError(null)
    setUploading(true)
    const url = await upload(file)
    setUploading(false)
    if (!url) return setError('Não foi possível enviar o arquivo.')
    setForm((f) => ({ ...f, fileUrl: url, fileName: file.name }))
  }

  async function onPhotos(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    const room = MAX_PHOTOS - form.photoUrls.length
    const valid = files.filter((f) => PHOTO_TYPES.includes(f.type) && f.size <= PHOTO_MAX_BYTES).slice(0, Math.max(room, 0))
    if (valid.length < files.length) setNotice(`Algumas fotos foram ignoradas (só JPG/PNG/WEBP até 10MB, máximo ${MAX_PHOTOS}).`)
    else setNotice(null)
    setError(null)
    setUploading(true)
    const urls = (await Promise.all(valid.map(upload))).filter((u): u is string => Boolean(u))
    setUploading(false)
    if (urls.length < valid.length) setError('Algumas fotos não foram enviadas. Tente de novo.')
    setForm((f) => ({ ...f, photoUrls: [...f.photoUrls, ...urls] }))
  }

  async function analyze() {
    if (analyzing || (!form.fileUrl && !form.description.trim())) return
    setAnalyzing(true)
    setError(null)
    setNotice(null)
    const res = await fetch(`/api/units/${unitId}/service-order/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileUrl: form.fileUrl || undefined, fileName: form.fileName || undefined, description: form.description || undefined }),
    }).catch(() => null)
    setAnalyzing(false)
    if (!res || !res.ok) return setError('Não foi possível analisar agora. Você pode preencher e criar a ordem normalmente.')
    const data = (await res.json()) as AnalyzeResponse
    if (data.failed) setNotice('A IA não conseguiu ler este material. Preencha à mão — a ordem pode ser criada mesmo assim.')
    else if (data.fileReadFailed) setNotice('A IA não conseguiu ler o arquivo, mas analisou a descrição.')
    const x = data.extraction
    // só preenche o que ainda está vazio: nunca sobrescreve o que o administrador digitou
    setForm((f) => ({
      ...f,
      orderNumber: f.orderNumber || x?.orderNumber || '',
      clientPo: f.clientPo || x?.clientPo || '',
      priority: f.priority || x?.priority || '',
      orderType: f.orderType || x?.orderType || '',
      locationName: f.locationName || x?.locationName || '',
      locationPhone: f.locationPhone || x?.locationPhone || '',
      address: f.address || x?.address || '',
      ivrPin: f.ivrPin || x?.ivrPin || '',
      issuerName: f.issuerName || x?.issuerName || '',
      issuerEmail: f.issuerEmail || x?.issuerEmail || '',
      scopeEn: f.scopeEn || x?.scopeEn || '',
      summaryPt: f.summaryPt || x?.summaryPt || '',
      analysis: data.analysis ?? f.analysis,
    }))
  }

  async function save() {
    if (saving) return
    const problem = validateIntake(form)
    if (problem) return setError(problem)
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const customer = await resolveClientCustomerId(supabase, { unitId, orgId, clientName: form.clientName })
    if (!customer.ok) {
      setSaving(false)
      return setError(customer.error)
    }
    const row = buildIntakeAppointmentRow({ orgId, unitId, customerId: customer.customerId, timezone, form })
    const { error: insertError } = await supabase.from('appointments').insert(row)
    setSaving(false)
    if (insertError) return setError('Não foi possível criar a ordem. Tente de novo.')
    setCreated(true)
    await onSaved()
  }

  const a = form.analysis
  const canAnalyze = !analyzing && !uploading && (Boolean(form.fileUrl) || Boolean(form.description.trim()))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <Card className="w-full max-w-2xl p-6">
        <div onClick={(e) => e.stopPropagation()} className="max-h-[85vh] overflow-y-auto">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-white">Anexar ordem</h2>
              <p className="text-xs text-slate-400">Anexe o PDF da ordem e/ou cole a descrição, escolha o cliente e (se tiver) envie fotos. A ordem entra na Agenda sem técnico.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Fechar" className="text-slate-500 hover:text-slate-300">
              <X size={16} />
            </button>
          </div>

          {created ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-emerald-300" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)' }}>
                <CheckCircle2 size={16} />
                Ordem criada para {form.clientName}. Na Agenda, use “Atribuir profissional e horário”.
              </div>
              <button type="button" onClick={onClose} className="w-fit rounded-xl px-4 py-2.5 text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
                Fechar
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Cliente *</Label>
                  <Select value={form.clientName} onChange={(e) => set('clientName', e.target.value)}>
                    <option value="">Escolha o cliente…</option>
                    {clients.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </Select>
                  {clients.length === 0 && <p className="text-[11px] text-amber-400">Nenhum cliente cadastrado. Cadastre em “Clientes Facility”.</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Data prevista *</Label>
                  <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Arquivo da ordem (PDF ou foto)</Label>
                <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={onFile} className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-200" />
                {form.fileName && <p className="text-[11px] text-emerald-400">Anexado: {form.fileName}</p>}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Descrição da ordem (cole o texto, se não tiver o PDF)</Label>
                <Textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Cole aqui a descrição da WO recebida por e-mail" />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Fotos (opcional)</Label>
                <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={onPhotos} className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-200" />
                {form.photoUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {form.photoUrls.map((url) => (
                      <div key={url} className="relative">
                        <img src={url} alt="Foto da ordem" className="h-16 w-16 rounded-lg object-cover" />
                        <button type="button" aria-label="Remover foto" onClick={() => set('photoUrls', form.photoUrls.filter((u) => u !== url))} className="absolute -right-1 -top-1 rounded-full bg-black/80 p-0.5 text-slate-200">
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {uploading && (
                <p className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Loader2 size={12} className="animate-spin" /> Enviando…
                </p>
              )}

              <div className="flex flex-col gap-2 rounded-xl px-3.5 py-3" style={{ background: 'rgba(129,140,248,0.06)', border: '1px solid rgba(129,140,248,0.2)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-black uppercase tracking-wider text-indigo-300">Análise da IA</span>
                  <button type="button" disabled={!canAnalyze} onClick={() => void analyze()} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
                    {analyzing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    {analyzing ? 'Lendo a ordem…' : a ? 'Analisar de novo' : 'Analisar com IA'}
                  </button>
                </div>
                {!a && !analyzing && <p className="text-[11px] text-slate-500">A IA lê o PDF/descrição e diz qual é a demanda, o que provavelmente vai precisar de material e uma ideia do escopo. É só apoio: você revisa.</p>}
                {a?.insufficient && <p className="text-xs text-amber-400">Não há informação suficiente no texto para concluir a demanda. Complete a descrição e analise de novo, se quiser.</p>}
                {a && !a.insufficient && (
                  <div className="flex flex-col gap-2 text-xs text-slate-200">
                    {a.demandPt && (
                      <p>
                        <span className="font-bold text-white">Demanda: </span>
                        {a.demandPt}
                      </p>
                    )}
                    {a.materials.length > 0 && (
                      <div>
                        <p className="font-bold text-white">Material provável (confirmar na visita):</p>
                        <ul className="ml-4 list-disc">
                          {a.materials.map((m) => (
                            <li key={m.item}>
                              {m.item}
                              {m.note ? <span className="text-slate-400"> — {m.note}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {a.scopeIdeaPt && (
                      <p>
                        <span className="font-bold text-white">Ideia do escopo: </span>
                        {a.scopeIdeaPt}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <details className="rounded-xl px-3.5 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <summary className="cursor-pointer select-none text-xs font-bold text-slate-300">Dados da ordem (preenchidos pela IA, pode editar)</summary>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Nº da ordem (PO)</Label>
                    <Input value={form.orderNumber} onChange={(e) => set('orderNumber', e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Loja / local</Label>
                    <Input value={form.locationName} onChange={(e) => set('locationName', e.target.value)} />
                  </div>
                  <div className="col-span-2 flex flex-col gap-1.5">
                    <Label>Endereço</Label>
                    <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
                  </div>
                  <div className="col-span-2 flex flex-col gap-1.5">
                    <Label>Scope of Work (inglês — vai para o PDF do cliente)</Label>
                    <Textarea rows={3} value={form.scopeEn} onChange={(e) => set('scopeEn', e.target.value)} />
                  </div>
                </div>
              </details>

              {notice && <p className="text-xs text-amber-400">{notice}</p>}
              {error && (
                <p role="alert" className="text-xs font-semibold text-red-400">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" disabled={saving || uploading} onClick={() => void save()} className="rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}>
                  {saving ? 'Criando…' : 'Criar ordem'}
                </button>
                <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-300" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
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
