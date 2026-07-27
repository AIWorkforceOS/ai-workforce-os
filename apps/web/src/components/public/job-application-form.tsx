'use client'

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'

const RESUME_MAX_BYTES = 15 * 1024 * 1024
const brandGradient = 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)'

type Copy = {
  name: string
  email: string
  phone: string
  resume: string
  resumeHint: string
  submit: string
  submitting: string
  success: string
  errorGeneric: string
  errorPdf: string
  errorSize: string
  errorContact: string
}

const COPY: Record<'pt' | 'en', Copy> = {
  pt: {
    name: 'Nome completo',
    email: 'E-mail',
    phone: 'Telefone (WhatsApp)',
    resume: 'Currículo (PDF, opcional)',
    resumeHint: 'Até 15MB, formato PDF.',
    submit: 'Enviar candidatura',
    submitting: 'Enviando...',
    success: 'Candidatura recebida! Em breve alguém entra em contato.',
    errorGeneric: 'Não foi possível enviar sua candidatura. Tente novamente.',
    errorPdf: 'O currículo deve ser um arquivo PDF.',
    errorSize: 'O currículo deve ter no máximo 15MB.',
    errorContact: 'Informe e-mail ou telefone para contato.',
  },
  en: {
    name: 'Full name',
    email: 'Email',
    phone: 'Phone (WhatsApp)',
    resume: 'Resume (PDF, optional)',
    resumeHint: 'Up to 15MB, PDF format.',
    submit: 'Submit application',
    submitting: 'Submitting...',
    success: 'Application received! Someone will reach out soon.',
    errorGeneric: 'Could not submit your application. Please try again.',
    errorPdf: 'The resume must be a PDF file.',
    errorSize: 'The resume must be at most 15MB.',
    errorContact: 'Provide an email or phone number for contact.',
  },
}

export function JobApplicationForm({ token, locale }: { token: string; locale: 'pt' | 'en' }) {
  const t = COPY[locale]
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setError(null)
    if (!file) {
      setResumeFile(null)
      return
    }
    if (file.type !== 'application/pdf') {
      setError(t.errorPdf)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (file.size > RESUME_MAX_BYTES) {
      setError(t.errorSize)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setResumeFile(file)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!email.trim() && !phone.trim()) {
      setError(t.errorContact)
      return
    }

    setBusy(true)
    try {
      const formData = new FormData()
      formData.set('name', name.trim())
      formData.set('email', email.trim())
      formData.set('phone', phone.trim())
      if (resumeFile) formData.set('resume', resumeFile)

      const response = await fetch(`/api/public/job-application/${token}`, {
        method: 'POST',
        body: formData,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error ?? t.errorGeneric)
        return
      }
      setSuccess(true)
    } catch {
      setError(t.errorGeneric)
    } finally {
      setBusy(false)
    }
  }

  if (success) {
    return (
      <p className="rounded-xl px-4 py-3 text-sm text-emerald-300" style={{ background: 'rgba(34,197,94,0.12)' }}>
        {t.success}
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="applicantName" className="text-xs font-bold uppercase tracking-wide text-slate-400">
          {t.name}
        </label>
        <input
          id="applicantName"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-xl px-3 py-2 text-sm text-white outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="applicantEmail" className="text-xs font-bold uppercase tracking-wide text-slate-400">
            {t.email}
          </label>
          <input
            id="applicantEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl px-3 py-2 text-sm text-white outline-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="applicantPhone" className="text-xs font-bold uppercase tracking-wide text-slate-400">
            {t.phone}
          </label>
          <input
            id="applicantPhone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="rounded-xl px-3 py-2 text-sm text-white outline-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="applicantResume" className="text-xs font-bold uppercase tracking-wide text-slate-400">
          {t.resume}
        </label>
        <input
          id="applicantResume"
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
          className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-200"
        />
        <p className="text-[11px] text-slate-500">{t.resumeHint}</p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="self-start rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
        style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
      >
        {busy ? t.submitting : t.submit}
      </button>
    </form>
  )
}
