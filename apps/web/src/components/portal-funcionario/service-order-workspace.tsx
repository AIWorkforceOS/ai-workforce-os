'use client'

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Camera, CheckCircle2, Clock, Download, PenLine, Receipt, ShoppingCart, Upload, X } from 'lucide-react'
import { Input, Label, Textarea } from '@/components/ui/dashboard-ui'
import type { PortalAppointment } from '@/lib/portal-funcionario/data'
import { addPendingSave, deleteDraft, listPendingSaves, loadDraft, localId, saveDraft, type StoredFile } from '@/lib/portal-funcionario/offline-store'
import { onDrainProgress } from '@/lib/portal-funcionario/offline-sync'
import { createStageTimer, recordSaveTiming, type SaveTiming } from '@/lib/portal-funcionario/save-timing'
import { createSubmitGuard } from '@/lib/portal-funcionario/submit-guard'
import { isDraftWorthSaving, type DraftFields } from '@/lib/portal-funcionario/draft'
import { SignaturePad } from './signature-pad'
import { VideoSection } from './video-section'
import { MultiShotCamera } from './multi-shot-camera'
import { useFieldOrder } from './field-order-context'
import { CopyToGalleryButton } from './copy-to-gallery-button'
import { MediaDownloadPanel } from './media-download-panel'
import { CameraPermissionGate } from './camera-permission-gate'
import { saveCopiesToDevice } from '@/lib/portal-funcionario/save-to-device'
import { getCurrentFix } from '@/lib/portal-funcionario/geolocation'
import { directMediaUploadEnabled } from '@/lib/portal-funcionario/media-upload'
import { saveViaQueue, type LiveSaveResult } from '@/lib/portal-funcionario/live-save'
import { QuoteAgentPanel } from './quote-agent-panel'
import { SignOffPdfActions } from './signoff-pdf-actions'
import { OpenPdfButton } from './open-pdf-button'
import { hasSignedSignOff } from '@/lib/service-orders/signoff-file'

/** File → StoredFile (mesmo Blob, só junto do nome/tipo) — o que a fila offline guarda. */
function toStoredFile(file: File): StoredFile {
  return { blob: file, name: file.name, type: file.type }
}

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
/** Quantos anexos de OUTROS salvamentos desta ordem ainda esperam na fila (vídeos subindo em segundo plano). */
async function countOtherPending(appointmentId: string, exceptId: string): Promise<number> {
  try {
    const items = await listPendingSaves()
    return items.filter((item) => item.appointmentId === appointmentId && item.id !== exceptId && !item.fields?.__event).reduce((n, item) => n + Object.values(item.files ?? {}).reduce((m, list) => m + list.length, 0), 0)
  } catch {
    return 0
  }
}

export function ServiceOrderWorkspace({
  appointment,
  onSaved,
  requireGps: requireGpsProp,
  onFinished: onFinishedProp,
  quoteAgentEnabled = false,
  showSignOffCard = true,
}: {
  /** O painel do admin já mostra o cartão de baixar/compartilhar no resumo da ordem: lá o formulário embutido não repete. */
  showSignOffCard?: boolean
  /** Piloto do Super Agente de Cotações: o técnico está autorizado e a unidade está em modo ao vivo (decidido no servidor). */
  quoteAgentEnabled?: boolean
  appointment: PortalAppointment
  /** Técnico com check-in por GPS: ao assinar e salvar, a posição e a hora de fim vão junto (o tempo de serviço para aí). */
  requireGps?: boolean
  /** Chamado quando a ordem foi assinada e salva (ou guardada no aparelho) com o horário de fim. */
  onFinished?: (endedAt: string) => void
  /** chamado depois de um salvamento confirmado no servidor (não nas fotos-only nem no fallback offline) — pedido do Vinicius (2026-09-16): admin também usa este componente (via ServiceOrderAttachModal) e precisa que a lista da Agenda atualize ao fechar. */
  onSaved?: () => void
}) {
  const fieldOrder = useFieldOrder()
  const requireGps = requireGpsProp ?? fieldOrder.requireGps
  const onFinished = onFinishedProp ?? fieldOrder.onFinished
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
  const [savedOffline, setSavedOffline] = useState(false)
  /** Motivo real da espera na fila (modo upload direto); null = texto padrão de "sem internet". */
  const [queuedNote, setQueuedNote] = useState<string | null>(null)
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const [draftReady, setDraftReady] = useState(false)
  // Salvar: trava contra duplo toque, andamento por etapa e GPS adiantado (ver handleSubmit)
  const submitGuardRef = useRef(createSubmitGuard())
  const saveIdRef = useRef<string | null>(null)
  const warmFixRef = useRef<{ startedAt: number; promise: ReturnType<typeof getCurrentFix> } | null>(null)
  const stageTimerRef = useRef<ReturnType<typeof createStageTimer> | null>(null)
  const [saveStage, setSaveStage] = useState<string | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState(0)
  useEffect(
    () =>
      onDrainProgress((event) => {
        if (event.itemId !== saveIdRef.current) return
        if (event.phase === 'uploading') setSaveStage(event.total > 0 ? `Enviando anexos (${event.done}/${event.total})…` : 'Enviando anexos…')
        else if (event.phase === 'registering') setSaveStage('Confirmando anexos…')
        else if (event.phase === 'finalizing') setSaveStage('Salvando assinatura e finalizando a ordem…')
        else if (event.phase === 'timing') stageTimerRef.current?.add(event.stage, event.ms)
      }),
    [],
  )
  const beforeFileInputRef = useRef<HTMLInputElement>(null)
  const afterFileInputRef = useRef<HTMLInputElement>(null)
  const beforeGalleryRef = useRef<HTMLInputElement>(null)
  const afterGalleryRef = useRef<HTMLInputElement>(null)
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

  /**
   * Salva só as fotos de uma seção, sem passar pelo formulário de
   * finalizar/cotar (sem "status" no FormData → rota trata como
   * photos-only, ver service-order/route.ts) — pedido real
   * (2026-09-15): o técnico tira foto "antes" ao chegar, mas só decide
   * Finalizado/Cotação e assina no FIM. Sem isso, a foto do início
   * nunca tinha como ser salva sozinha.
   */
  type PhotoSection = 'before' | 'after' | 'material'
  const [savingSection, setSavingSection] = useState<PhotoSection | null>(null)
  const [sectionError, setSectionError] = useState<{ section: PhotoSection; message: string } | null>(null)
  const [sectionSuccess, setSectionSuccess] = useState<PhotoSection | null>(null)
  const [sectionOffline, setSectionOffline] = useState<PhotoSection | null>(null)

  async function handleSavePhotosNow(section: PhotoSection, fieldName: string, files: File[], clear: () => void) {
    if (files.length === 0) return
    // Cópia de segurança na galeria ANTES de enviar (precisa ser no toque do botão: iPhone/Android só abrem a folha de compartilhar assim).
    if (autoGallery) await saveCopiesToDevice(files, { downloadFallback: false }).catch(() => null)
    setSavingSection(section)
    setSectionError(null)
    setSectionSuccess(null)
    setSectionOffline(null)
    setQueuedNote(null)
    if (directMediaUploadEnabled()) {
      const result = await saveViaQueue({
        id: localId(),
        unitId: appt.unit_id,
        appointmentId: appt.id,
        fields: {},
        files: { [fieldName]: files.map(toStoredFile) },
      })
      setSavingSection(null)
      if (result.kind === 'not_stored') {
        setSectionError({ section, message: 'Não foi possível guardar as fotos no aparelho. Tente novamente.' })
        return
      }
      clear()
      if (result.kind === 'synced') {
        if (result.patch) setAppt((prev) => ({ ...prev, ...(result.patch as ServiceOrderPatch) }))
        setSectionSuccess(section)
        onSaved?.()
      } else if (result.kind === 'failed') {
        setSectionError({ section, message: `${result.message} (guardado no aparelho — veja em Sincronização)` })
      } else {
        setQueuedNote(result.label)
        setSectionOffline(section)
      }
      return
    }
    const formData = new FormData()
    for (const photo of files) formData.append(fieldName, photo)
    // mesmo id na requisição e, se cair pra fila offline, no item guardado — reenvio nunca duplica foto.
    const saveId = localId()
    formData.set('clientSaveId', saveId)
    try {
      const response = await fetch(`/api/units/${appt.unit_id}/appointments/${appt.id}/service-order`, {
        method: 'PATCH',
        body: formData,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.appointment) {
        setSectionError({ section, message: data?.error ?? 'Não foi possível salvar as fotos.' })
        return
      }
      setAppt((prev) => ({ ...prev, ...(data.appointment as ServiceOrderPatch) }))
      clear()
      setSectionSuccess(section)
      onSaved?.()
    } catch {
      // Sem internet no momento: guarda localmente em vez de perder as fotos —
      // pedido do Vinicius (2026-09-15). A sincronização automática (ver
      // OfflineSyncManager no layout) reenvia sozinha quando a conexão voltar.
      const savedLocally = await addPendingSave({
        id: saveId,
        unitId: appt.unit_id,
        appointmentId: appt.id,
        fields: {},
        files: { [fieldName]: files.map(toStoredFile) },
      })
      if (savedLocally) {
        clear()
        setSectionOffline(section)
      } else {
        setSectionError({ section, message: 'Não foi possível salvar as fotos. Verifique sua conexão e tente novamente.' })
      }
    } finally {
      setSavingSection(null)
    }
  }

  const serverValues: DraftFields = {
    status: appointment.service_order_status === 'quote' ? 'quote' : 'completed',
    signedBy: appointment.service_order_signed_by ?? '',
    partPurchaseLink: appointment.service_order_part_purchase_link ?? '',
    materialDescription: appointment.service_order_material_description ?? '',
    materialValue: appointment.service_order_material_value != null ? String(appointment.service_order_material_value) : '',
    hoursNeeded: appointment.service_order_hours_needed != null ? String(appointment.service_order_hours_needed) : '',
  }

  // Restaura o rascunho guardado neste aparelho (se a página foi recarregada/fechada antes de salvar).
  useEffect(() => {
    let cancelled = false
    loadDraft(appointment.id).then((draft) => {
      if (cancelled) return
      if (draft) {
        const f = draft.fields
        if (f.status === 'quote' || f.status === 'completed') setStatus(f.status)
        setSignedBy(f.signedBy ?? '')
        setPartPurchaseLink(f.partPurchaseLink ?? '')
        setMaterialDescription(f.materialDescription ?? '')
        setMaterialValue(f.materialValue ?? '')
        setHoursNeeded(f.hoursNeeded ?? '')
        const toFiles = (list: StoredFile[] | undefined) => (list ?? []).map((s) => new File([s.blob], s.name, { type: s.type }))
        setPhotosBefore(toFiles(draft.files.photosBefore))
        setPhotosAfter(toFiles(draft.files.photosAfter))
        setMaterialPhotos(toFiles(draft.files.materialPhotos))
        setSignatureDataUrl(draft.signatureDataUrl)
        setDraftSavedAt(draft.updatedAt)
      }
      setDraftReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [appointment.id])

  // Grava o rascunho (com pequeno atraso) a cada mudança — só depois de restaurar, pra não sobrescrever com o estado vazio inicial.
  useEffect(() => {
    if (!draftReady) return
    const timer = setTimeout(async () => {
      const current: DraftFields = { status, signedBy, partPurchaseLink, materialDescription, materialValue, hoursNeeded }
      const fileCount = photosBefore.length + photosAfter.length + materialPhotos.length
      if (!isDraftWorthSaving({ current, serverValues, fileCount, hasSignature: Boolean(signatureDataUrl) })) {
        await deleteDraft(appointment.id)
        setDraftSavedAt(null)
        return
      }
      const files: Record<string, StoredFile[]> = {}
      if (photosBefore.length > 0) files.photosBefore = photosBefore.map(toStoredFile)
      if (photosAfter.length > 0) files.photosAfter = photosAfter.map(toStoredFile)
      if (materialPhotos.length > 0) files.materialPhotos = materialPhotos.map(toStoredFile)
      const updatedAt = Date.now()
      const ok = await saveDraft({ appointmentId: appointment.id, unitId: appointment.unit_id, updatedAt, fields: current, signatureDataUrl, files })
      if (ok) setDraftSavedAt(updatedAt)
    }, 600)
    return () => clearTimeout(timer)
  }, [draftReady, status, signedBy, partPurchaseLink, materialDescription, materialValue, hoursNeeded, photosBefore, photosAfter, materialPhotos, signatureDataUrl])

  const beforePhotoPreviews = useFilePreviews(photosBefore)
  const afterPhotoPreviews = useFilePreviews(photosAfter)
  const materialPhotoPreviews = useFilePreviews(materialPhotos)
  const [autoGallery, setAutoGallery] = useState(true)
  useEffect(() => {
    try {
      setAutoGallery(localStorage.getItem('alizo_auto_gallery') !== '0')
    } catch {}
  }, [])
  function changeAutoGallery(on: boolean) {
    setAutoGallery(on)
    try {
      localStorage.setItem('alizo_auto_gallery', on ? '1' : '0')
    } catch {}
  }
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null)

  /** Exclui foto/vídeo já salvo: some da ordem, do PDF e do relatório fotográfico (o arquivo continua guardado no servidor). */
  async function deleteSavedMedia(url: string, isVideo: boolean) {
    if (!window.confirm(isVideo ? 'Excluir este vídeo da ordem? Ele sai do relatório fotográfico.' : 'Excluir esta foto da ordem? Ela sai do relatório fotográfico.')) return
    setDeleteError(null)
    setDeletingUrl(url)
    try {
      const response = await fetch(`/api/units/${appt.unit_id}/appointments/${appt.id}/service-order/media`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.photos) {
        setDeleteError(data?.error ?? 'Não foi possível excluir. Tente de novo.')
        return
      }
      setAppt((prev) => ({ ...prev, service_order_photos: data.photos }))
      onSaved?.()
    } catch {
      setDeleteError('Sem internet agora — a exclusão precisa de conexão. Tente de novo quando voltar.')
    } finally {
      setDeletingUrl(null)
    }
  }

  const savedBeforePhotos = appt.service_order_photos.filter((photo) => photo.kind === 'before')
  const savedAfterPhotos = appt.service_order_photos.filter((photo) => photo.kind === 'after')
  // kind ausente/'service' = fotos salvas antes da distinção antes/depois (migration 061) — mostradas à parte pra não sumir do histórico.
  const savedUnclassifiedPhotos = appt.service_order_photos.filter((photo) => !photo.kind || photo.kind === 'service')
  const savedMaterialInvoicePhotos = appt.service_order_photos.filter((photo) => photo.kind === 'material_invoice')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Duplo toque: só o primeiro vale. O botão já mostra "Salvando…" ANTES de qualquer espera (galeria, GPS, fila).
    if (submitGuardRef.current.active) return
    setSubmitting(true)
    setSaveStage('Preparando…')
    const timer = createStageTimer()
    stageTimerRef.current = timer
    await submitGuardRef.current.run(async () => {
      try {
        await runSubmit(timer)
      } finally {
        saveIdRef.current = null
        stageTimerRef.current = null
        setSubmitting(false)
        setSaveStage(null)
      }
    })
  }

  async function runSubmit(timer: ReturnType<typeof createStageTimer>) {
    setError(null)
    setPendingAttachments(0)
    setSuccess(false)
    setSavedOffline(false)
    setQueuedNote(null)

    if (status === 'completed' && !signedBy.trim()) {
      setError('Informe o nome de quem assinou para finalizar.')
      return
    }
    if (status === 'completed' && !signatureDataUrl && !appt.service_order_signature_url) {
      setError('Peça para o gerente da loja assinar para finalizar.')
      return
    }

    if (autoGallery) {
      const copies = [...photosBefore, ...photosAfter, ...materialPhotos]
      // A cópia na galeria abre a folha de compartilhar do celular e só termina quando a pessoa a fecha: NÃO pode segurar o salvamento.
      // As fotos já estão guardadas no aparelho pela fila antes de subir, então rodar junto não arrisca nada.
      if (copies.length > 0) void saveCopiesToDevice(copies, { downloadFallback: false }).catch(() => null)
    }

    // Fim do tempo de serviço: assinatura + salvar. Com check-in por GPS, tenta pegar a posição agora.
    const endExtra: Record<string, string> = {}
    const hasSignature = Boolean(signatureDataUrl || appt.service_order_signature_url) && Boolean(signedBy.trim())
    if (requireGps && hasSignature) {
      setSubmitting(true)
      // A posição começou a ser buscada quando o gerente assinou (ver warmFixRef): normalmente já está pronta e não há espera nenhuma.
      const geo = await timer.measure('gps', async () => {
        const warm = warmFixRef.current
        if (warm && Date.now() - warm.startedAt < 10 * 60_000) {
          const warmed = await warm.promise
          if (warmed.ok) return warmed
        }
        return getCurrentFix({ timeoutMs: 15_000 })
      })
      // Sem posição (bloqueada/indisponível): a ordem NÃO fica presa — salva com a hora e sem coordenadas (o admin vê "sem GPS").
      endExtra.endedAt = new Date().toISOString()
      if (geo.ok) {
        endExtra.endLat = String(geo.fix.lat)
        endExtra.endLng = String(geo.fix.lng)
        endExtra.endAcc = String(geo.fix.accuracy)
      }
    }

    const fields = {
      status,
      signedBy: signedBy.trim(),
      partPurchaseLink: status === 'quote' ? partPurchaseLink.trim() : '',
      materialDescription: status === 'quote' ? materialDescription.trim() : '',
      materialValue: status === 'quote' ? materialValue.trim() : '',
      hoursNeeded: hoursNeeded.trim(),
      ...endExtra,
    }
    const signatureFile = signatureDataUrl
      ? new File([await dataUrlToBlob(signatureDataUrl)], 'assinatura.png', { type: 'image/png' })
      : null

    const formData = new FormData()
    for (const [key, value] of Object.entries(fields)) formData.set(key, value)
    for (const photo of photosBefore) formData.append('photosBefore', photo)
    for (const photo of photosAfter) formData.append('photosAfter', photo)
    for (const photo of materialPhotos) formData.append('materialPhotos', photo)
    if (signatureFile) formData.set('signature', signatureFile)
    const saveId = localId()
    formData.set('clientSaveId', saveId)

    function clearForm() {
      warmFixRef.current = null
      void deleteDraft(appt.id)
      setDraftSavedAt(null)
      setPhotosBefore([])
      setPhotosAfter([])
      setMaterialPhotos([])
      setSignatureDataUrl(null)
      if (beforeFileInputRef.current) beforeFileInputRef.current.value = ''
      if (afterFileInputRef.current) afterFileInputRef.current.value = ''
      if (materialFileInputRef.current) materialFileInputRef.current.value = ''
    }

    setSubmitting(true)
    saveIdRef.current = saveId
    setSaveStage('Guardando no aparelho…')
    const fileCount = photosBefore.length + photosAfter.length + materialPhotos.length + (signatureFile ? 1 : 0)
    const megabytes = Math.round(([...photosBefore, ...photosAfter, ...materialPhotos].reduce((n, f) => n + f.size, signatureFile?.size ?? 0) / 1048576) * 10) / 10
    const record = (outcome: SaveTiming['outcome']) => recordSaveTiming({ at: new Date().toISOString(), files: fileCount, megabytes, stages: timer.finish(), outcome })
    if (directMediaUploadEnabled()) {
      const files: Record<string, StoredFile[]> = {}
      if (photosBefore.length > 0) files.photosBefore = photosBefore.map(toStoredFile)
      if (photosAfter.length > 0) files.photosAfter = photosAfter.map(toStoredFile)
      if (materialPhotos.length > 0) files.materialPhotos = materialPhotos.map(toStoredFile)
      if (signatureFile) files.signature = [toStoredFile(signatureFile)]
      const result: LiveSaveResult = await saveViaQueue({ id: saveId, unitId: appt.unit_id, appointmentId: appt.id, fields, files })
      record(result.kind)
      // Vídeos (ou outros anexos) desta ordem que ainda estão subindo em segundo plano: o Sign Off foi salvo, mas a ordem NÃO está 100% sincronizada.
      setPendingAttachments(result.kind === 'synced' ? await countOtherPending(appt.id, saveId) : 0)
      setSubmitting(false)
      if (result.kind === 'not_stored') {
        setError('Não foi possível guardar no aparelho. Tente novamente.')
      } else if (result.kind === 'failed') {
        clearForm()
        setError(`${result.message} (guardado no aparelho — veja em Sincronização)`)
      } else if (result.kind === 'queued') {
        clearForm()
        setQueuedNote(result.label)
        setSavedOffline(true)
        if (endExtra.endedAt) onFinished?.(endExtra.endedAt)
      } else {
        if (result.patch) setAppt((prev) => ({ ...prev, ...(result.patch as ServiceOrderPatch) }))
        setSuccess(true)
        clearForm()
        onSaved?.()
        if (endExtra.endedAt) onFinished?.(endExtra.endedAt)
      }
      return
    }
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
      clearForm()
      onSaved?.()
      if (endExtra.endedAt) onFinished?.(endExtra.endedAt)
    } catch {
      // Sem internet no momento: guarda localmente (fotos + assinatura + campos
      // preenchidos) em vez de perder o trabalho — pedido do Vinicius
      // (2026-09-15). A sincronização automática (OfflineSyncManager no
      // layout) reenvia sozinha assim que a conexão voltar, mesmo que o
      // técnico já tenha saído desta tela.
      const files: Record<string, StoredFile[]> = {}
      if (photosBefore.length > 0) files.photosBefore = photosBefore.map(toStoredFile)
      if (photosAfter.length > 0) files.photosAfter = photosAfter.map(toStoredFile)
      if (materialPhotos.length > 0) files.materialPhotos = materialPhotos.map(toStoredFile)
      if (signatureFile) files.signature = [toStoredFile(signatureFile)]

      const savedLocally = await addPendingSave({ id: saveId, unitId: appt.unit_id, appointmentId: appt.id, fields, files })
      if (savedLocally) {
        clearForm()
        setSavedOffline(true)
        if (endExtra.endedAt) onFinished?.(endExtra.endedAt)
      } else {
        setError('Não foi possível salvar. Verifique sua conexão e tente novamente.')
      }
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
          // Adianta a busca do GPS: quando o técnico tocar em Salvar a posição já está pronta (antes, o salvar esperava até 15 s por ela).
          if (requireGps) warmFixRef.current = { startedAt: Date.now(), promise: getCurrentFix({ timeoutMs: 15_000 }) }
        }}
        onCancel={() => setShowSignaturePad(false)}
      />
    )
  }

  // Sign Off já assinado e salvo no servidor: mostra os botões de baixar/compartilhar bem no topo
  const isSignedOrder = hasSignedSignOff(appt)

  // alterações ainda NÃO enviadas ao servidor (rascunho local ou fotos novas): o agente só inicia depois de tudo salvo
  const hasUnsavedChanges = draftSavedAt !== null || photosBefore.length + photosAfter.length + materialPhotos.length > 0

  return (
    <>
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <CameraPermissionGate />
      <label className="flex items-center gap-2 text-xs text-slate-300">
        <input type="checkbox" checked={autoGallery} onChange={(e) => changeAutoGallery(e.target.checked)} />
        Ao salvar, guardar também uma cópia das fotos na galeria do celular
      </label>
      {deleteError && <p className="text-xs text-red-400">{deleteError}</p>}
      {draftSavedAt && (
        <p
          className="rounded-xl px-3 py-2 text-xs font-bold text-amber-200"
          style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}
        >
          Rascunho salvo neste aparelho às {new Date(draftSavedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — ainda NÃO enviado ao servidor. Toque em salvar abaixo para enviar.
        </p>
      )}
      {isSignedOrder && showSignOffCard && (
        <SignOffPdfActions
          unitId={appt.unit_id}
          appointmentId={appt.id}
          orderNumber={appt.service_order_number}
          startsAt={appt.starts_at}
          version={`${appt.service_order_signed_at ?? ''}|${appt.service_order_signature_url ?? ''}|${appt.service_order_photos.length}|${appt.service_order_status}`}
        />
      )}
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
              placeholder={quoteAgentEnabled ? "Descreva o defeito em poucas palavras (a IA monta a lista de materiais)" : "Descreva a peça/material necessário para a compra"}
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
              <div key={i} className="relative h-16 w-16">
                <a href={photo.url} target="_blank" rel="noreferrer">
                  <img src={photo.url} alt="Foto antes do trabalho" className="h-16 w-16 rounded-lg object-cover" />
                </a>
                <button
                  type="button"
                  disabled={deletingUrl === photo.url}
                  onClick={() => deleteSavedMedia(photo.url, false)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white disabled:opacity-50"
                  style={{ background: '#ef4444' }}
                  aria-label="Excluir foto"
                >
                  <X size={12} />
                </button>
              </div>
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
        <MultiShotCamera label="Câmera contínua (várias fotos de uma vez)" onShot={(file) => setPhotosBefore((prev) => [...prev, file])} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => beforeFileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-cyan-200"
            style={{ background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.4)' }}
          >
            <Camera size={14} /> Tirar foto
          </button>
          <button
            type="button"
            onClick={() => beforeGalleryRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-slate-200"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            Escolher da galeria
          </button>
        </div>
        <input ref={beforeFileInputRef} type="file" accept="image/*" capture="environment" onChange={handleBeforePhotosChange} className="hidden" />
        <input ref={beforeGalleryRef} type="file" accept="image/*" multiple onChange={handleBeforePhotosChange} className="hidden" />
        <CopyToGalleryButton files={photosBefore} />
        {photosBefore.length > 0 && (
          <>
            <p className="flex items-center gap-1 text-xs text-slate-400">
              <Camera size={12} />
              {photosBefore.length} nova{photosBefore.length === 1 ? '' : 's'} foto{photosBefore.length === 1 ? '' : 's'} selecionada
              {photosBefore.length === 1 ? '' : 's'}
            </p>
            <button
              type="button"
              disabled={savingSection === 'before'}
              onClick={() => handleSavePhotosNow('before', 'photosBefore', photosBefore, () => setPhotosBefore([]))}
              className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-cyan-300 transition-colors hover:text-cyan-200 disabled:opacity-50"
              style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)' }}
            >
              <Upload size={13} />
              {savingSection === 'before' ? 'Salvando…' : 'Salvar estas fotos agora'}
            </button>
          </>
        )}
        {sectionSuccess === 'before' && <p className="text-xs font-semibold text-emerald-400">Fotos salvas.</p>}
        {sectionOffline === 'before' && (
          <p className="text-xs font-semibold text-amber-400">{queuedNote ? `Salvo no aparelho — ${queuedNote}. Nada foi perdido.` : 'Sem internet — já salvamos no aparelho, vai enviar sozinho depois.'}</p>
        )}
        {sectionError?.section === 'before' && <p className="text-xs text-red-400">{sectionError.message}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Fotos DEPOIS do trabalho</Label>
        {savedAfterPhotos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {savedAfterPhotos.map((photo, i) => (
              <div key={i} className="relative h-16 w-16">
                <a href={photo.url} target="_blank" rel="noreferrer">
                  <img src={photo.url} alt="Foto depois do trabalho" className="h-16 w-16 rounded-lg object-cover" />
                </a>
                <button
                  type="button"
                  disabled={deletingUrl === photo.url}
                  onClick={() => deleteSavedMedia(photo.url, false)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white disabled:opacity-50"
                  style={{ background: '#ef4444' }}
                  aria-label="Excluir foto"
                >
                  <X size={12} />
                </button>
              </div>
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
        <MultiShotCamera label="Câmera contínua (várias fotos de uma vez)" onShot={(file) => setPhotosAfter((prev) => [...prev, file])} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => afterFileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-cyan-200"
            style={{ background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.4)' }}
          >
            <Camera size={14} /> Tirar foto
          </button>
          <button
            type="button"
            onClick={() => afterGalleryRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-slate-200"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            Escolher da galeria
          </button>
        </div>
        <input ref={afterFileInputRef} type="file" accept="image/*" capture="environment" onChange={handleAfterPhotosChange} className="hidden" />
        <input ref={afterGalleryRef} type="file" accept="image/*" multiple onChange={handleAfterPhotosChange} className="hidden" />
        <CopyToGalleryButton files={photosAfter} />
        {photosAfter.length > 0 && (
          <>
            <p className="flex items-center gap-1 text-xs text-slate-400">
              <Camera size={12} />
              {photosAfter.length} nova{photosAfter.length === 1 ? '' : 's'} foto{photosAfter.length === 1 ? '' : 's'} selecionada
              {photosAfter.length === 1 ? '' : 's'}
            </p>
            <button
              type="button"
              disabled={savingSection === 'after'}
              onClick={() => handleSavePhotosNow('after', 'photosAfter', photosAfter, () => setPhotosAfter([]))}
              className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-cyan-300 transition-colors hover:text-cyan-200 disabled:opacity-50"
              style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)' }}
            >
              <Upload size={13} />
              {savingSection === 'after' ? 'Salvando…' : 'Salvar estas fotos agora'}
            </button>
          </>
        )}
        {sectionSuccess === 'after' && <p className="text-xs font-semibold text-emerald-400">Fotos salvas.</p>}
        {sectionOffline === 'after' && (
          <p className="text-xs font-semibold text-amber-400">{queuedNote ? `Salvo no aparelho — ${queuedNote}. Nada foi perdido.` : 'Sem internet — já salvamos no aparelho, vai enviar sozinho depois.'}</p>
        )}
        {sectionError?.section === 'after' && <p className="text-xs text-red-400">{sectionError.message}</p>}
      </div>

      {savedUnclassifiedPhotos.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Outras fotos (antes da separação antes/depois)</Label>
          <div className="flex flex-wrap gap-2">
            {savedUnclassifiedPhotos.map((photo, i) => (
              <div key={i} className="relative h-16 w-16">
                <a href={photo.url} target="_blank" rel="noreferrer">
                  <img src={photo.url} alt="Foto do atendimento" className="h-16 w-16 rounded-lg object-cover" />
                </a>
                <button
                  type="button"
                  disabled={deletingUrl === photo.url}
                  onClick={() => deleteSavedMedia(photo.url, false)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white disabled:opacity-50"
                  style={{ background: '#ef4444' }}
                  aria-label="Excluir foto"
                >
                  <X size={12} />
                </button>
              </div>
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
              <div key={i} className="relative h-16 w-16">
                <a href={photo.url} target="_blank" rel="noreferrer">
                  <img src={photo.url} alt="Nota fiscal de material" className="h-16 w-16 rounded-lg object-cover" />
                </a>
                <button
                  type="button"
                  disabled={deletingUrl === photo.url}
                  onClick={() => deleteSavedMedia(photo.url, false)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white disabled:opacity-50"
                  style={{ background: '#ef4444' }}
                  aria-label="Excluir foto"
                >
                  <X size={12} />
                </button>
              </div>
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
        <MultiShotCamera label="Câmera (várias notas)" onShot={(file) => setMaterialPhotos((prev) => [...prev, file])} />
        <input
          ref={materialFileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handleMaterialPhotosChange}
          className="hidden"
        />
        <CopyToGalleryButton files={materialPhotos} />
        {materialPhotos.length > 0 && (
          <button
            type="button"
            disabled={savingSection === 'material'}
            onClick={() => handleSavePhotosNow('material', 'materialPhotos', materialPhotos, () => setMaterialPhotos([]))}
            className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-emerald-300 transition-colors hover:text-emerald-200 disabled:opacity-50"
            style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}
          >
            <Upload size={13} />
            {savingSection === 'material' ? 'Salvando…' : 'Salvar estas fotos agora'}
          </button>
        )}
        {sectionSuccess === 'material' && <p className="text-xs font-semibold text-emerald-400">Fotos salvas.</p>}
        {sectionOffline === 'material' && (
          <p className="text-xs font-semibold text-amber-400">{queuedNote ? `Salvo no aparelho — ${queuedNote}. Nada foi perdido.` : 'Sem internet — já salvamos no aparelho, vai enviar sozinho depois.'}</p>
        )}
        {sectionError?.section === 'material' && <p className="text-xs text-red-400">{sectionError.message}</p>}
      </div>

      {directMediaUploadEnabled() && (
        <VideoSection
          unitId={appt.unit_id}
          appointmentId={appt.id}
          savedVideos={appt.service_order_photos.filter((photo) => photo.kind === 'video')}
          onDelete={(url) => deleteSavedMedia(url, true)}
        />
      )}

      {!(isSignedOrder && showSignOffCard) && (
        <OpenPdfButton
          url={`/api/units/${appt.unit_id}/appointments/${appt.id}/service-order/pdf`}
          fallbackName={`SignOff_${appt.service_order_number ?? 'ordem'}.pdf`}
          className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-slate-200 transition-colors hover:text-white"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}
        >
          <Download size={13} />
          {appt.service_order_status === 'pending' ? 'Ver ordem em PDF (pra mostrar ao gerente)' : 'Ver ordem de serviço em PDF'}
        </OpenPdfButton>
      )}
      <MediaDownloadPanel media={appt.service_order_photos} orderNumber={appt.service_order_number} />
      {appt.service_order_photos.length > 0 && (
        <OpenPdfButton
          url={`/api/units/${appt.unit_id}/appointments/${appt.id}/service-order/pdf?report=photos`}
          fallbackName={`relatorio-fotografico-${appt.service_order_number ?? 'ordem'}.pdf`}
          className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-slate-200 transition-colors hover:text-white"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}
        >
          <Download size={13} />
          Ver relatório fotográfico (PDF)
        </OpenPdfButton>
      )}

      <div
        className="sticky bottom-0 -mx-4 mt-2 flex flex-col gap-2 px-4 py-3 sm:mx-0 sm:rounded-2xl"
        style={{ background: 'rgba(10,15,30,0.95)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {error && <p className="text-xs text-red-400">{error}</p>}
        {success && pendingAttachments === 0 && <p className="text-xs font-semibold text-emerald-400">Salvo com sucesso.</p>}
        {success && pendingAttachments > 0 && (
          <p className="text-xs font-semibold text-amber-300">
            Sign Off e assinatura salvos. Ainda há {pendingAttachments} anexo{pendingAttachments > 1 ? 's' : ''} (vídeo) enviando — a ordem ainda NÃO está 100% sincronizada. Pode sair da tela: o app termina sozinho e mostra o andamento em Sincronização.
          </p>
        )}
        {savedOffline && (
          <p className="text-xs font-semibold text-amber-400">
            {queuedNote
              ? `Salvo no aparelho — ${queuedNote}. Nada foi perdido.`
              : 'Sem internet agora — já salvamos tudo (fotos e assinatura) no seu aparelho. Vai enviar sozinho assim que a conexão voltar, nada foi perdido.'}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl px-4 py-4 text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
        >
          {submitting ? (saveStage ?? 'Salvando…') : 'Salvar ordem de serviço'}
        </button>
      </div>
    </form>
    {quoteAgentEnabled && appt.service_order_status === 'quote' && (
      <QuoteAgentPanel
        unitId={appt.unit_id}
        appointmentId={appt.id}
        savedStatus={appt.service_order_status}
        hasUnsavedChanges={hasUnsavedChanges}
        onPhotosChanged={(photos) => setAppt((prev) => ({ ...prev, service_order_photos: photos as typeof prev.service_order_photos }))}
      />
    )}
    </>
  )
}
