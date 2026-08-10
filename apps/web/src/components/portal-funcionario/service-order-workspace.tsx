'use client'

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Camera, CheckCircle2, Clock, Download, PenLine, Receipt, ShoppingCart, X } from 'lucide-react'
import { Input, Label, Textarea } from '@/components/ui/dashboard-ui'
import type { PortalAppointment } from '@/lib/portal-funcionario/data'
import { SignaturePad } from './signature-pad'

/** Gera (e revoga ao trocar/desmontar) URLs de preview locais pros arquivos ainda não enviados — evita recriar um object URL novo a cada render. */
function useFilePreviews(files: File[]): string[] {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const next = files.map((file) => URL.createObjectURL(file))
    setUrls(next)
    return () => {
      for (const url of next) URL.revokeObjectURL(url)
    }
  }, [files])
  return urls
}

type ServiceOrderPatch = Pick<
  PortalAppointment,
  | 'service_order_status'
  | 'service_order_signed_by'
  | 'service_order_signed_at'
  | 'service_order_signature_url'
  | 'service_order_part_purchase_link'
  | 'service_order_material_description'
  | 'service_order_material_value'
  | 'service_order_hours_needed'
  | 'service_order_photos'
>

/** data: URL (gerada pelo canvas) → Blob, pra anexar no FormData como arquivo igual às fotos. */
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl)
  return response.blob()
}

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
  const [photosBefore, setPhotosBefore] = useState<File[]>([])
  const [photosAfter, setPhotosAfter] = useState<File[]>([])
  const [materialPhotos, setMaterialPhotos] = useState<File[]>([])
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [showSignaturePad, setShowSignaturePad] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const beforeFileInputRef = useRef<HTMLInputElement>(null)
  const afterFileInputRef = useRef<HTMLInputElement>(null)
  const materialFileInputRef = useRef<HTMLInputElement>(null)

  // capture="environment" abre a câmera nativa que tira 1 foto e fecha o input a cada toque —
  // por isso acumula com o que já foi selecionado em vez de substituir, senão cada foto nova apaga a anterior.
  function handleBeforePhotosChange(event: ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(event.target.files ?? [])
    if (newFiles.length > 0) setPhotosBefore((prev) => [...prev, ...newFiles])
    event.target.value = ''
  }

  function removeBeforePhoto(index: number) {
    setPhotosBefore((prev) => prev.filter((_, i) => i !== index))
  }

  function handleAfterPhotosChange(event: ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(event.target.files ?? [])
    if (newFiles.length > 0) setPhotosAfter((prev) => [...prev, ...newFiles])
    event.target.value = ''
  }

  function removeAfterPhoto(index: number) {
    setPhotosAfter((prev) => prev.filter((_, i) => i !== index))
  }

  function handleMaterialPhotosChange(event: ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(event.target.files ?? [])
    if (newFiles.length > 0) setMaterialPhotos((prev) => [...prev, ...newFiles])
    event.target.value = ''
  }

  function removeMaterialPhoto(index: number) {
    setMaterialPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  const beforePhotoPreviews = useFilePreviews(photosBefore)
  const afterPhotoPreviews = useFilePreviews(photosAfter)
  const materialPhotoPreviews = useFilePreviews(materialPhotos)
  const savedBeforePhotos = appt.service_order_photos.filter((photo) => photo.kind === 'before')
  const savedAfterPhotos = appt.service_order_photos.filter((photo) => photo.kind === 'after')
  // kind ausente/'service' = fotos salvas antes da distinção antes/depois (migration 061) — mostradas à parte pra não sumir do histórico.
  const savedUnclassifiedPhotos = appt.service_order_photos.filter((photo) => !photo.kind || photo.kind === 'service')
  const savedMaterialInvoicePhotos = appt.service_order_photos.filter((photo) => photo.kind === 'material_invoice')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(false)

    if (status === 'completed' && !signedBy.trim()) {
      setError('Informe o nome de quem assinou para finalizar.')
      return
    }
    if (status === 'completed' && !signatureDataUrl && !appt.service_order_signature_url) {
      setError('Peça para o gerente da loja assinar para finalizar.')
      return
    }

    const formData = new FormData()
    formData.set('status', status)
    formData.set('signedBy', signedBy.trim())
    formData.set('partPurchaseLink', status === 'quote' ? partPurchaseLink.trim() : '')
    formData.set('materialDescription', status === 'quote' ? materialDescription.trim() : '')
    formData.set('materialValue', status === 'quote' ? materialValue.trim() : '')
    formData.set('hoursNeeded', hoursNeeded.trim())
    for (const photo of photosBefore) formData.append('photosBefore', photo)
    for (const photo of photosAfter) formData.append('photosAfter', photo)
    for (const photo of materialPhotos) formData.append('materialPhotos', photo)
    if (signatureDataUrl) {
      const signatureBlob = await dataUrlToBlob(signatureDataUrl)
      formData.set('signature', new File([signatureBlob], 'assinatura.png', { type: 'image/png' }))
    }

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
      setPhotosBefore([])
      setPhotosAfter([])
      setMaterialPhotos([])
      setSignatureDataUrl(null)
      if (beforeFileInputRef.current) beforeFileInputRef.current.value = ''
      if (afterFileInputRef.current) afterFileInputRef.current.value = ''
      if (materialFileInputRef.current) materialFileInputRef.current.value = ''
    } catch {
      setError('Não foi possível salvar. Verifique sua conexão e tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  if (showSignaturePad) {
    return (
      <SignaturePad
        onSave={(dataUrl) => {
          setSignatureDataUrl(dataUrl)
          setShowSignaturePad(false)
        }}
        onCancel={() => setShowSignaturePad(false)}
      />
    )
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
        <Label>Assinatura do gerente {status === 'completed' ? '*' : '(opcional)'}</Label>
        {(signatureDataUrl || appt.service_order_signature_url) && (
          <img
            src={signatureDataUrl ?? appt.service_order_signature_url ?? undefined}
            alt="Assinatura do gerente"
            className="h-24 w-full rounded-xl object-contain"
            style={{ background: '#fff' }}
          />
        )}
        <button
          type="button"
          onClick={() => setShowSignaturePad(true)}
          className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-cyan-300 transition-colors hover:text-cyan-200"
          style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)' }}
        >
          <PenLine size={13} />
          {signatureDataUrl || appt.service_order_signature_url ? 'Assinar novamente' : 'Assinar'}
        </button>
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
        <Label>Fotos ANTES do trabalho</Label>
        {savedBeforePhotos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {savedBeforePhotos.map((photo, i) => (
              <a key={i} href={photo.url} target="_blank" rel="noreferrer">
                <img src={photo.url} alt="Foto antes do trabalho" className="h-16 w-16 rounded-lg object-cover" />
              </a>
            ))}
          </div>
        )}
        {photosBefore.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {photosBefore.map((photo, i) => (
              <div key={i} className="relative h-16 w-16">
                <img
                  src={beforePhotoPreviews[i]}
                  alt="Nova foto antes do trabalho"
                  className="h-16 w-16 rounded-lg object-cover"
                  style={{ border: '2px solid rgba(6,182,212,0.5)' }}
                />
                <button
                  type="button"
                  onClick={() => removeBeforePhoto(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white"
                  style={{ background: '#ef4444' }}
                  aria-label="Remover foto"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={beforeFileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handleBeforePhotosChange}
          className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-bold file:text-slate-200"
        />
        {photosBefore.length > 0 && (
          <p className="flex items-center gap-1 text-xs text-slate-400">
            <Camera size={12} />
            {photosBefore.length} nova{photosBefore.length === 1 ? '' : 's'} foto{photosBefore.length === 1 ? '' : 's'} selecionada
            {photosBefore.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Fotos DEPOIS do trabalho</Label>
        {savedAfterPhotos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {savedAfterPhotos.map((photo, i) => (
              <a key={i} href={photo.url} target="_blank" rel="noreferrer">
                <img src={photo.url} alt="Foto depois do trabalho" className="h-16 w-16 rounded-lg object-cover" />
              </a>
            ))}
          </div>
        )}
        {photosAfter.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {photosAfter.map((photo, i) => (
              <div key={i} className="relative h-16 w-16">
                <img
                  src={afterPhotoPreviews[i]}
                  alt="Nova foto depois do trabalho"
                  className="h-16 w-16 rounded-lg object-cover"
                  style={{ border: '2px solid rgba(6,182,212,0.5)' }}
                />
                <button
                  type="button"
                  onClick={() => removeAfterPhoto(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white"
                  style={{ background: '#ef4444' }}
                  aria-label="Remover foto"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={afterFileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handleAfterPhotosChange}
          className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-bold file:text-slate-200"
        />
        {photosAfter.length > 0 && (
          <p className="flex items-center gap-1 text-xs text-slate-400">
            <Camera size={12} />
            {photosAfter.length} nova{photosAfter.length === 1 ? '' : 's'} foto{photosAfter.length === 1 ? '' : 's'} selecionada
            {photosAfter.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {savedUnclassifiedPhotos.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Outras fotos (antes da separação antes/depois)</Label>
          <div className="flex flex-wrap gap-2">
            {savedUnclassifiedPhotos.map((photo, i) => (
              <a key={i} href={photo.url} target="_blank" rel="noreferrer">
                <img src={photo.url} alt="Foto do atendimento" className="h-16 w-16 rounded-lg object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}

      <div
        className="flex flex-col gap-2 rounded-2xl p-4"
        style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.18)' }}
      >
        <Label>
          <span className="inline-flex items-center gap-1.5">
            <ShoppingCart size={13} />
            Compra de material
          </span>
        </Label>
        <p className="text-xs text-slate-400">Tire uma foto da nota fiscal da compra do material para anexar como comprovante.</p>
        {savedMaterialInvoicePhotos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {savedMaterialInvoicePhotos.map((photo, i) => (
              <a key={i} href={photo.url} target="_blank" rel="noreferrer">
                <img src={photo.url} alt="Nota fiscal de material" className="h-16 w-16 rounded-lg object-cover" />
              </a>
            ))}
          </div>
        )}
        {materialPhotos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {materialPhotos.map((photo, i) => (
              <div key={i} className="relative h-16 w-16">
                <img
                  src={materialPhotoPreviews[i]}
                  alt="Nova nota fiscal"
                  className="h-16 w-16 rounded-lg object-cover"
                  style={{ border: '2px solid rgba(16,185,129,0.5)' }}
                />
                <button
                  type="button"
                  onClick={() => removeMaterialPhoto(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white"
                  style={{ background: '#ef4444' }}
                  aria-label="Remover foto"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => materialFileInputRef.current?.click()}
          className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-emerald-300 transition-colors hover:text-emerald-200"
          style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}
        >
          <Camera size={13} />
          Compra Material
        </button>
        <input
          ref={materialFileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handleMaterialPhotosChange}
          className="hidden"
        />
      </div>

      {appt.service_order_status !== 'pending' && (
        <a
          href={`/api/units/${appt.unit_id}/appointments/${appt.id}/service-order/pdf`}
          target="_blank"
          rel="noreferrer"
          className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-slate-200 transition-colors hover:text-white"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}
        >
          <Download size={13} />
          Baixar ordem de serviço em PDF
        </a>
      )}

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
