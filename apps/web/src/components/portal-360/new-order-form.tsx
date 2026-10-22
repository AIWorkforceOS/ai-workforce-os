'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, ImagePlus, Upload, X } from 'lucide-react'
import { Card, Input, Label, Select, Textarea } from '@/components/ui/dashboard-ui'
import { ORDER_PRIORITIES } from '@/lib/portal-360/order-request'

const FILE_MAX_BYTES = 15 * 1024 * 1024
const PHOTO_MAX_BYTES = 10 * 1024 * 1024
const MAX_PHOTOS = 10
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * New order (portal do cliente, sempre em inglês): o cliente pode anexar o documento da ordem (PDF/foto), OU escrever/colar a descrição, ou os dois; pode
 * anexar fotos, escolher a prioridade e informar o valor e o tempo já aprovados. O escritório atribui técnico e horário depois.
 * Envia tudo para POST /api/portal-360/orders.
 */
export function NewOrderForm() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [photos, setPhotos] = useState<File[]>([])
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('Medium')
  const [locationName, setLocationName] = useState('')
  const [address, setAddress] = useState('')
  const [approvedAmount, setApprovedAmount] = useState('')
  const [approvedHours, setApprovedHours] = useState('')
  const [requestedDate, setRequestedDate] = useState(todayIsoDate())
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFieldError(null)
    const selected = event.target.files?.[0] ?? null
    if (!selected) return setFile(null)
    if (!ACCEPTED_TYPES.includes(selected.type) || selected.size > FILE_MAX_BYTES) {
      setFieldError('The file must be a PDF, JPG, PNG or WEBP up to 15MB.')
      return setFile(null)
    }
    setFile(selected)
  }

  function handlePhotos(event: ChangeEvent<HTMLInputElement>) {
    setFieldError(null)
    const picked = Array.from(event.target.files ?? [])
    event.target.value = ''
    const valid = picked.filter((p) => PHOTO_TYPES.includes(p.type) && p.size <= PHOTO_MAX_BYTES)
    if (valid.length < picked.length) setFieldError('Photos must be JPG, PNG or WEBP up to 10MB each.')
    setPhotos((prev) => [...prev, ...valid].slice(0, MAX_PHOTOS))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!file && !description.trim()) return setError('Attach the service order or write/paste the order description.')
    if (!requestedDate) return setError('Choose the day you would like this handled.')

    const formData = new FormData()
    if (file) formData.set('file', file)
    for (const p of photos) formData.append('photos', p)
    formData.set('requestedDate', requestedDate)
    formData.set('description', description)
    formData.set('priority', priority)
    formData.set('locationName', locationName)
    formData.set('address', address)
    formData.set('approvedAmount', approvedAmount)
    formData.set('approvedHours', approvedHours)

    setSubmitting(true)
    try {
      const response = await fetch('/api/portal-360/orders', { method: 'POST', body: formData })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.id) return setError(data?.error ?? 'Could not submit the order. Please try again.')
      router.push(`/portal-360/order/${data.id}`)
      router.refresh()
    } catch {
      setError('Could not submit the order. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-1">
        <div className="flex flex-col gap-2">
          <Label>Order description</Label>
          <Textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} placeholder="Write or paste the work order here — what needs to be done, where, and any access notes." />
          <p className="text-xs text-slate-500">You can write the order, attach the document, or both.</p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Service order file (optional)</Label>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl px-4 py-6 text-center transition-colors hover:bg-white/[0.03]" style={{ border: '1px dashed rgba(255,255,255,0.15)' }}>
            {file ? <FileText size={22} className="text-cyan-400" /> : <Upload size={22} className="text-slate-500" />}
            <span className="text-sm font-semibold text-slate-200">{file ? file.name : 'Choose a PDF or photo'}</span>
            <span className="text-xs text-slate-500">PDF, JPG, PNG or WEBP — up to 15MB</span>
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={handleFileChange} className="hidden" />
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Photos (optional)</Label>
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/[0.04]" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
            <ImagePlus size={16} className="text-cyan-400" />
            Add photos
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={handlePhotos} className="hidden" />
          </label>
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <span key={`${p.name}-${i}`} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-slate-200" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {p.name}
                  <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-400">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500">Up to {MAX_PHOTOS} photos, 10MB each.</p>
        </div>
        {fieldError && <p className="text-xs text-red-400">{fieldError}</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>Priority</Label>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="py-3 text-base">
              {ORDER_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Requested day *</Label>
            <Input type="date" value={requestedDate} min={todayIsoDate()} onChange={(e) => setRequestedDate(e.target.value)} required className="py-3 text-base" />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Store / location (optional)</Label>
            <Input value={locationName} onChange={(e) => setLocationName(e.target.value)} maxLength={120} placeholder="Store #12 — Downtown" className="py-3 text-base" />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Address (optional)</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} placeholder="123 Main St, Miami, FL" className="py-3 text-base" />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Approved amount, USD (if any)</Label>
            <Input inputMode="decimal" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} placeholder="e.g. 1,500.00" className="py-3 text-base" />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Approved time, hours (if any)</Label>
            <Input inputMode="decimal" value={approvedHours} onChange={(e) => setApprovedHours(e.target.value)} placeholder="e.g. 6" className="py-3 text-base" />
          </div>
        </div>
        <p className="-mt-2 text-xs text-slate-500">Mawi will assign the technician and exact time — you&apos;ll see it here once scheduled. If the work needs more than the approved amount or time, Mawi will send you a quote to approve.</p>

        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}

        <button type="submit" disabled={submitting} className="w-full rounded-xl px-4 py-4 text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}>
          {submitting ? 'Submitting…' : 'Submit order'}
        </button>
      </form>
    </Card>
  )
}
