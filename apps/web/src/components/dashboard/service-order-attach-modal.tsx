'use client'

import { useState, type ChangeEvent } from 'react'
import { FileText, Sparkles, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isExtractableImageFile } from '@/lib/service-orders/extraction'
import { Card, Input, Label, Textarea } from '@/components/ui/dashboard-ui'
import type { AppointmentWithRelations } from '@/components/dashboard/calendar-view'

const FILE_MAX_BYTES = 15 * 1024 * 1024
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

/**
 * Anexar (ou editar) a ordem de serviço de um agendamento — Fase A do
 * fluxo Mawi/360 (general_maintenance). O admin sobe o PDF/foto da
 * ordem recebida da contratante; se for imagem, chama a extração por
 * IA (resumo em PT + endereço + número) pra pré-preencher os campos,
 * mas SEMPRE deixa revisar/editar antes de salvar — nunca some direto
 * pro banco sem passar pelos olhos de alguém, é extração de IA.
 */
export function ServiceOrderAttachModal({
  unitId,
  appointment,
  onClose,
  onSaved,
}: {
  unitId: string
  appointment: AppointmentWithRelations
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState(appointment.service_order_file_url ?? '')
  const [fileName, setFileName] = useState(appointment.service_order_file_name ?? '')
  const [orderNumber, setOrderNumber] = useState(appointment.service_order_number ?? '')
  const [summaryPt, setSummaryPt] = useState(appointment.service_order_summary_pt ?? '')
  const [address, setAddress] = useState(appointment.address ?? '')
  const [uploading, setUploading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    setError(null)
    if (!selected) {
      setFile(null)
      return
    }
    if (!ACCEPTED_TYPES.includes(selected.type)) {
      setError('Envie um PDF ou uma imagem (JPG, PNG, WEBP).')
      return
    }
    if (selected.size > FILE_MAX_BYTES) {
      setError('O arquivo deve ter no máximo 15MB.')
      return
    }
    setFile(selected)
  }

  async function handleUploadAndExtract() {
    if (!file) return
    setError(null)
    setUploading(true)
    const supabase = createClient()
    const path = `${unitId}/${appointment.id}/ordem-${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage
      .from('service-orders')
      .upload(path, file, { contentType: file.type, upsert: true })
    setUploading(false)
    if (uploadError) {
      setError('Não foi possível enviar o arquivo.')
      return
    }
    const { data: publicUrlData } = supabase.storage.from('service-orders').getPublicUrl(path)
    setFileUrl(publicUrlData.publicUrl)
    setFileName(file.name)

    if (!isExtractableImageFile(file.name)) {
      // PDF: sem OCR nesta fase — o arquivo já fica anexado e abrível, os campos ficam pra preenchimento manual.
      return
    }

    setExtracting(true)
    try {
      const response = await fetch(`/api/units/${unitId}/appointments/${appointment.id}/service-order/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: publicUrlData.publicUrl }),
      })
      if (response.ok) {
        const data = (await response.json()) as { summaryPt: string | null; address: string | null; orderNumber: string | null }
        if (data.summaryPt) setSummaryPt(data.summaryPt)
        if (data.orderNumber) setOrderNumber(data.orderNumber)
        // Só preenche endereço se ainda estiver vazio — nunca sobrescreve o que já foi digitado.
        if (data.address && !address.trim()) setAddress(data.address)
      }
    } catch {
      // Extração é bônus — falha aqui nunca deve travar o anexo do arquivo em si.
    } finally {
      setExtracting(false)
    }
  }

  async function handleSave() {
    setError(null)
    if (!fileUrl) {
      setError('Envie o arquivo da ordem de serviço.')
      return
    }
    setSaving(true)
    const supabase = createClient()
    const { error: updateError } = await supabase
      .from('appointments')
      .update({
        service_order_file_url: fileUrl,
        service_order_file_name: fileName || null,
        service_order_number: orderNumber.trim() || null,
        service_order_summary_pt: summaryPt.trim() || null,
        address: address.trim() || null,
      })
      .eq('id', appointment.id)
    setSaving(false)
    if (updateError) {
      setError('Não foi possível salvar a ordem de serviço.')
      return
    }
    await onSaved()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <Card className="w-full max-w-lg p-6">
        <div onClick={(e) => e.stopPropagation()} className="max-h-[85vh] overflow-y-auto">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="text-sm font-black text-white">Ordem de serviço</h2>
            <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">
              <X size={16} />
            </button>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Arquivo da ordem (PDF ou foto)</Label>
              {fileUrl && !file && (
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs font-bold text-cyan-400 hover:text-cyan-300"
                >
                  <FileText size={13} />
                  {fileName || 'Ver arquivo já anexado'}
                </a>
              )}
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-200"
              />
              {file && (
                <button
                  type="button"
                  disabled={uploading || extracting}
                  onClick={handleUploadAndExtract}
                  className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
                >
                  <Sparkles size={13} />
                  {uploading ? 'Enviando…' : extracting ? 'Lendo o documento…' : 'Enviar e preencher com IA'}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Número da ordem</Label>
              <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="Ex: 132617" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Endereço do atendimento</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Onde o serviço será prestado" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Resumo do trabalho (em português)</Label>
              <Textarea
                rows={4}
                value={summaryPt}
                onChange={(e) => setSummaryPt(e.target.value)}
                placeholder="O técnico vê este texto direto na agenda — descreva objetivamente o que precisa ser feito."
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                disabled={saving || uploading || extracting}
                onClick={handleSave}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
              >
                {saving ? 'Salvando…' : 'Salvar ordem de serviço'}
              </button>
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
        </div>
      </Card>
    </div>
  )
}
