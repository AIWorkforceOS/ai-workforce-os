'use client'

import { useState, type ChangeEvent } from 'react'
import { CheckCircle2, Clock, FileText, Link2, Package, Sparkles, UserCheck, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isExtractableAttachment } from '@/lib/service-orders/extraction'
import { Badge, Card, Input, Label, Textarea, type BadgeVariant } from '@/components/ui/dashboard-ui'
import type { AppointmentWithRelations } from '@/components/dashboard/calendar-view'

const FILE_MAX_BYTES = 15 * 1024 * 1024
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

const SERVICE_ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  completed: 'Finalizado',
  quote: 'Cotação',
}

const SERVICE_ORDER_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'amber',
  completed: 'green',
  quote: 'purple',
}

function formatCurrencyBrl(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Tudo que o TÉCNICO preencheu depois que o admin anexou a ordem
 * (assinatura, fotos, material/valor, horas, link de compra) — pedido
 * direto do dono do produto: o admin precisa enxergar isso pra
 * acompanhar o trabalho, não só o que ele mesmo anexou. Só aparece
 * quando existe algo preenchido pelo técnico.
 */
function TechnicianReportSection({ appointment }: { appointment: AppointmentWithRelations }) {
  const hasTechnicianData = Boolean(
    appointment.service_order_signed_by ||
      appointment.service_order_photos.length > 0 ||
      appointment.service_order_material_description ||
      appointment.service_order_material_value != null ||
      appointment.service_order_hours_needed != null ||
      appointment.service_order_part_purchase_link ||
      appointment.service_order_status !== 'pending',
  )
  if (!hasTechnicianData) return null

  return (
    <div className="flex flex-col gap-3 rounded-xl p-4" style={{ background: 'rgba(129,140,248,0.06)', border: '1px solid rgba(129,140,248,0.18)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-black uppercase tracking-wider text-indigo-300">O que o técnico registrou</span>
        <Badge variant={SERVICE_ORDER_STATUS_VARIANT[appointment.service_order_status] ?? 'slate'}>
          {SERVICE_ORDER_STATUS_LABEL[appointment.service_order_status] ?? appointment.service_order_status}
        </Badge>
      </div>

      {appointment.service_order_signed_by && (
        <p className="flex items-center gap-1.5 text-xs text-slate-300">
          <UserCheck size={13} className="text-indigo-300" />
          Assinado por <span className="font-semibold text-white">{appointment.service_order_signed_by}</span>
          {appointment.service_order_signed_at
            ? ` em ${new Date(appointment.service_order_signed_at).toLocaleDateString('pt-BR')}`
            : ''}
        </p>
      )}

      {appointment.service_order_hours_needed != null && (
        <p className="flex items-center gap-1.5 text-xs text-slate-300">
          <Clock size={13} className="text-indigo-300" />
          Horas necessárias: <span className="font-semibold text-white">{appointment.service_order_hours_needed}h</span>
        </p>
      )}

      {(appointment.service_order_material_description || appointment.service_order_material_value != null) && (
        <div className="flex flex-col gap-1 text-xs text-slate-300">
          <p className="flex items-center gap-1.5">
            <Package size={13} className="text-indigo-300" />
            <span className="font-semibold text-white">Material necessário</span>
          </p>
          {appointment.service_order_material_description && <p className="pl-[19px]">{appointment.service_order_material_description}</p>}
          {appointment.service_order_material_value != null && (
            <p className="pl-[19px] font-semibold text-white">{formatCurrencyBrl(appointment.service_order_material_value)}</p>
          )}
        </div>
      )}

      {appointment.service_order_part_purchase_link && (
        <a
          href={appointment.service_order_part_purchase_link}
          target="_blank"
          rel="noreferrer"
          className="flex w-fit items-center gap-1.5 text-xs font-bold text-cyan-400 hover:text-cyan-300"
        >
          <Link2 size={13} />
          Link de compra da peça
        </a>
      )}

      {appointment.service_order_photos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-slate-300">Fotos do atendimento ({appointment.service_order_photos.length})</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {appointment.service_order_photos.map((photo, i) => (
              <a
                key={i}
                href={photo.url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-lg transition-opacity hover:opacity-80"
                style={{ border: '1px solid rgba(255,255,255,0.1)' }}
              >
                <img src={photo.url} alt="Foto do atendimento" className="aspect-square w-full object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

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
  const [extractionFailed, setExtractionFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    setError(null)
    setSuccess(false)
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
    setExtractionFailed(false)
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

    if (!isExtractableAttachment(file.name)) {
      return
    }

    setExtracting(true)
    try {
      const response = await fetch(`/api/units/${unitId}/appointments/${appointment.id}/service-order/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl: publicUrlData.publicUrl, fileName: file.name }),
      })
      if (response.ok) {
        const data = (await response.json()) as {
          summaryPt: string | null
          address: string | null
          orderNumber: string | null
          failed: boolean
        }
        if (data.summaryPt) setSummaryPt(data.summaryPt)
        if (data.orderNumber) setOrderNumber(data.orderNumber)
        // Só preenche endereço se ainda estiver vazio — nunca sobrescreve o que já foi digitado.
        if (data.address && !address.trim()) setAddress(data.address)
        setExtractionFailed(data.failed)
      } else {
        setExtractionFailed(true)
      }
    } catch {
      setExtractionFailed(true)
    } finally {
      setExtracting(false)
    }
  }

  async function handleSave() {
    setError(null)
    setSuccess(false)
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
    // Não fecha o modal automaticamente: o admin já clicou "Salvar" mais de
    // uma vez achando que não tinha funcionado, porque o único feedback
    // antes disso era o modal sumir sem aviso. Agora fica visível até o
    // admin fechar de propósito.
    setSuccess(true)
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
              {extractionFailed && (
                <p className="text-xs font-semibold text-amber-400">
                  Não consegui ler o documento automaticamente. Preencha os campos abaixo manualmente.
                </p>
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

            <TechnicianReportSection appointment={appointment} />

            {error && <p className="text-sm text-red-400">{error}</p>}

            {success && (
              <div
                className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-emerald-300"
                style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)' }}
              >
                <CheckCircle2 size={16} />
                Ordem de serviço salva com sucesso.
              </div>
            )}

            {success ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
              >
                Fechar
              </button>
            ) : (
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
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
