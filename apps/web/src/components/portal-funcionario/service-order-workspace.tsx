'use client'

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Camera, CheckCircle2, Clock, Receipt } from 'lucide-react'
import { Input, Label, Textarea } from '@/components/ui/dashboard-ui'
import type { PortalAppointment, PortalServiceOrderPhoto } from '@/lib/portal-funcionario/data'

type ServiceOrderPatch = Pick<
  PortalAppointment,
  | 'service_order_status'
  | 'service_order_signed_by'
  | 'service_order_signed_at'
  | 'service_order_part_purchase_link'
  | 'service_order_material_description'
  | 'service_order_material_value'
  | 'service_order_hours_needed'
  | 'service_order_photos'
>

/**
 * Formulário único da ordem de serviço, pensado pro celular em campo:
 * toques grandes pra Finalizado/Cotação, fotos já anexadas ficam
 * visíveis na hora, botão de salvar fixo na parte de baixo da tela.
 * Mesma rota PATCH e mesma validação de sempre
 * (lib/service-orders/finalize.ts) — este componente só reorganiza a
 * UI num fluxo de tela única, não muda a regra de negócio.
 */
export function ServiceOrderWorkspace({ appointment }: { appointment: PortalAppointment }) {
  const [appt, setAppt] = useState(appointment)
  const [signedBy, setSignedBy] = useState(appt.service_order_signed_by ?? '')
  const [status, setStatus] = useState<'completed' | 'quote'>(appt.service_order_status === 'quote' ? 'quote' : 'completed')
  const [partPurchaseLink, setPartPurchaseLink] = useState(appt.service_order_part_purchase_link ?? '')
  const [materialDescription, setMaterialDescription] = useState(appt.service_order_material_description ?? '')
  const [materialValue, setMaterialValue] = useState(
    appt.service_order_material_value != null ? String(appt.service_order_material_value) : '',
  )
  const [hoursNeeded, setHoursNeeded] = useState(
    appt.service_order_hours_needed != null ? String(appt.service_order_hours_needed) : '',
  )
  const [photos, setPhotos] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handlePhotosChange(event: ChangeEvent<HTMLInputElement>) {
    setPhotos(Array.from(event.target.files ?? []))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(false)

    if (status === 'completed' && !signedBy.trim()) {
      setError('Informe o nome de quem assinou para finalizar.')
      return
    }

    const formData = new FormData()
    formData.set('status', status)
    formData.set('signedBy', signedBy.trim())
    formData.set('partPurchaseLink', status === 'quote' ? partPurchaseLink.trim() : '')
    formData.set('materialDescription', status === 'quote' ? materialDescription.trim() : '')
    formData.set('materialValue', status === 'quote' ? materialValue.trim() : '')
    formData.set('hoursNeeded', hoursNeeded.trim())
    for (const photo of photos) formData.append('photos', photo)

    setSubmitting(true)
    try {
      const response = await fetch(`/api/units/${appt.unit_id}/appointments/${appt.id}/service-order`, {
        method: 'PATCH',
        body: formData,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.appointment) {
        setError(data?.error ?? 'Não foi possível salvar. Tente novamente.')
        return
      }
      const patch = data.appointment as ServiceOrderPatch
      setAppt((prev) => ({ ...prev, ...patch }))
      setSuccess(true)
      setPhotos([])
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch {
      setError('Não foi possível salvar. Verifique sua conexão e tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {appt.service_order_status !== 'pending' && appt.service_order_signed_by && (
        <p className="text-xs text-slate-400">
          Assinado por <span className="font-semibold text-slate-200">{appt.service_order_signed_by}</span>
          {appt.service_order_signed_at ? ` em ${new Date(appt.service_order_signed_at).toLocaleDateString('pt-BR')}` : ''}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label>Nome de quem assinou {status === 'completed' ? '*' : '(opcional)'}</Label>
        <Input
          value={signedBy}
          onChange={(e) => setSignedBy(e.target.value)}
          placeholder="Nome do gerente da loja"
          className="py-3 text-base"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>O que aconteceu?</Label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setStatus('completed')}
            className="flex flex-col items-center gap-2 rounded-2xl px-4 py-5 text-sm font-bold transition-all active:scale-[0.98]"
            style={
              status === 'completed'
                ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: '#fff', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }
                : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#cbd5e1' }
            }
          >
            <CheckCircle2 size={22} />
            Finalizado
          </button>
          <button
            type="button"
            onClick={() => setStatus('quote')}
            className="flex flex-col items-center gap-2 rounded-2xl px-4 py-5 text-sm font-bold transition-all active:scale-[0.98]"
            style={
              status === 'quote'
                ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: '#fff', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }
                : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#cbd5e1' }
            }
          >
            <Receipt size={22} />
            Cotação
          </button>
        </div>
      </div>

      {status === 'quote' && (
        <div
          className="flex flex-col gap-4 rounded-2xl p-4"
          style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.18)' }}
        >
          <div className="flex flex-col gap-2">
            <Label>Link de compra da peça</Label>
            <Input
              type="url"
              value={partPurchaseLink}
              onChange={(e) => setPartPurchaseLink(e.target.value)}
              placeholder="https://..."
              className="py-3 text-base"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Material necessário</Label>
            <Textarea
              rows={3}
              value={materialDescription}
              onChange={(e) => setMaterialDescription(e.target.value)}
              placeholder="Descreva a peça/material necessário para a compra"
              className="text-base"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Valor estimado do material</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={materialValue}
              onChange={(e) => setMaterialValue(e.target.value)}
              placeholder="0,00"
              className="py-3 text-base"
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={12} />
            Horas necessárias para executar o trabalho
          </span>
        </Label>
        <Input
          type="number"
          inputMode="decimal"
          step="0.5"
          min="0"
          value={hoursNeeded}
          onChange={(e) => setHoursNeeded(e.target.value)}
          placeholder="Ex: 2.5"
          className="py-3 text-base"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Fotos</Label>
        {appt.service_order_photos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {appt.service_order_photos.map((photo: PortalServiceOrderPhoto, i: number) => (
              <a key={i} href={photo.url} target="_blank" rel="noreferrer">
                <img src={photo.url} alt="Foto do atendimento" className="h-16 w-16 rounded-lg object-cover" />
              </a>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handlePhotosChange}
          className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-bold file:text-slate-200"
        />
        {photos.length > 0 && (
          <p className="flex items-center gap-1 text-xs text-slate-400">
            <Camera size={12} />
            {photos.length} nova{photos.length === 1 ? '' : 's'} foto{photos.length === 1 ? '' : 's'} selecionada
            {photos.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      <div
        className="sticky bottom-0 -mx-4 mt-2 flex flex-col gap-2 px-4 py-3 sm:mx-0 sm:rounded-2xl"
        style={{ background: 'rgba(10,15,30,0.95)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {error && <p className="text-xs text-red-400">{error}</p>}
        {success && <p className="text-xs font-semibold text-emerald-400">Salvo com sucesso.</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl px-4 py-4 text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
        >
          {submitting ? 'Salvando…' : 'Salvar ordem de serviço'}
        </button>
      </div>
    </form>
  )
}
