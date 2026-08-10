'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Upload } from 'lucide-react'
import { Card, Input, Label } from '@/components/ui/dashboard-ui'

const FILE_MAX_BYTES = 15 * 1024 * 1024
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Formulário de anexo do Portal 360: só arquivo + dia desejado — sem
 * campo de profissional/horário, sem revisão dos campos extraídos por
 * IA (esses são de uso interno da Mawi, ver lib/service-orders/pdf.ts).
 * Envia tudo pra POST /api/portal-360/orders, que faz upload,
 * extração e criação da linha "pendente de atribuição" no servidor.
 */
export function NewOrderForm() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [requestedDate, setRequestedDate] = useState(todayIsoDate())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFileError(null)
    const selected = event.target.files?.[0] ?? null
    if (!selected) {
      setFile(null)
      return
    }
    if (!ACCEPTED_TYPES.includes(selected.type) || selected.size > FILE_MAX_BYTES) {
      setFileError('The file must be a PDF, JPG, PNG or WEBP up to 15MB.')
      setFile(null)
      return
    }
    setFile(selected)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!file) {
      setError('Attach the service order file.')
      return
    }
    if (!requestedDate) {
      setError('Choose the day you would like this handled.')
      return
    }

    const formData = new FormData()
    formData.set('file', file)
    formData.set('requestedDate', requestedDate)

    setSubmitting(true)
    try {
      const response = await fetch('/api/portal-360/orders', { method: 'POST', body: formData })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.id) {
        setError(data?.error ?? 'Could not submit the order. Please try again.')
        return
      }
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
          <Label>Service order file *</Label>
          <label
            className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl px-4 py-8 text-center transition-colors hover:bg-white/[0.03]"
            style={{ border: '1px dashed rgba(255,255,255,0.15)' }}
          >
            {file ? <FileText size={22} className="text-cyan-400" /> : <Upload size={22} className="text-slate-500" />}
            <span className="text-sm font-semibold text-slate-200">{file ? file.name : 'Choose a PDF or photo'}</span>
            <span className="text-xs text-slate-500">PDF, JPG, PNG or WEBP — up to 15MB</span>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
          {fileError && <p className="text-xs text-red-400">{fileError}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <Label>Requested day *</Label>
          <Input
            type="date"
            value={requestedDate}
            min={todayIsoDate()}
            onChange={(e) => setRequestedDate(e.target.value)}
            required
            className="py-3 text-base"
          />
          <p className="text-xs text-slate-500">Mawi will assign the technician and exact time — you'll see it here once scheduled.</p>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl px-4 py-4 text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
        >
          {submitting ? 'Submitting…' : 'Submit order'}
        </button>
      </form>
    </Card>
  )
}
