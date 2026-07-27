'use client'

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { FormSection, Input, Label, Textarea } from '@/components/ui/dashboard-ui'

const RESUME_MAX_BYTES = 15 * 1024 * 1024

/**
 * Cadastro manual de candidato pelo dono/RH (auditoria, gap fase 3/3):
 * para currículo recebido por fora (WhatsApp, e-mail, indicação).
 * Entra no mesmo pipeline de triagem/scoring da vaga.
 */
export function ManualCandidateForm({ jobId }: { jobId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function resetForm() {
    setName('')
    setEmail('')
    setPhone('')
    setNotes('')
    setResumeFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setError(null)
    if (!file) {
      setResumeFile(null)
      return
    }
    if (file.type !== 'application/pdf') {
      setError('O currículo deve ser um arquivo PDF.')
      return
    }
    if (file.size > RESUME_MAX_BYTES) {
      setError('O currículo deve ter no máximo 15MB.')
      return
    }
    setResumeFile(file)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (!name.trim()) {
      setError('Nome é obrigatório.')
      return
    }
    if (!email.trim() && !phone.trim()) {
      setError('Informe e-mail ou telefone para contato.')
      return
    }

    setBusy(true)
    try {
      const formData = new FormData()
      formData.set('name', name.trim())
      formData.set('email', email.trim())
      formData.set('phone', phone.trim())
      formData.set('notes', notes.trim())
      if (resumeFile) formData.set('resume', resumeFile)

      const response = await fetch(`/api/jobs/${jobId}/candidates`, { method: 'POST', body: formData })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error ?? 'Não foi possível adicionar o candidato.')
        return
      }
      setMessage(
        data.stage === 'ranked'
          ? `Candidato adicionado ao pipeline (nota ${data.matchScore ?? '—'}).`
          : 'Candidato adicionado ao pipeline (aguardando pontuação).',
      )
      resetForm()
      router.refresh()
    } catch {
      setError('Erro de rede ao adicionar o candidato.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-xl px-3 py-1.5 text-[12px] font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
        style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)' }}
      >
        + Adicionar candidato manualmente
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <FormSection
        title="Adicionar candidato manualmente"
        action={
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-200">
            Cancelar
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manualCandidateName">Nome *</Label>
            <Input id="manualCandidateName" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manualCandidateEmail">E-mail</Label>
            <Input id="manualCandidateEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manualCandidatePhone">Telefone (WhatsApp)</Label>
            <Input id="manualCandidatePhone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manualCandidateResume">Currículo (PDF, opcional)</Label>
            <input
              id="manualCandidateResume"
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-200"
            />
            {resumeFile && <p className="text-xs text-slate-400">{resumeFile.name}</p>}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="manualCandidateNotes">Observações (como chegou até você)</Label>
          <Textarea
            id="manualCandidateNotes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex: indicação de fulano, currículo recebido por WhatsApp"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {message && <p className="text-sm text-emerald-400">{message}</p>}

        <button
          type="submit"
          disabled={busy}
          className="self-start rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
        >
          {busy ? 'Adicionando...' : 'Adicionar candidato'}
        </button>
      </FormSection>
    </form>
  )
}
