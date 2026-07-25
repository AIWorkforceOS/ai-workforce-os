'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, Send, X } from 'lucide-react'
import { Input, Textarea } from '@/components/ui/dashboard-ui'

/**
 * Ações humanas sobre uma campanha pending_approval: aprovar (e disparar
 * de verdade pra lista inteira), rejeitar, ou editar assunto/corpo antes
 * de decidir — mesmo espírito de content-post-actions.tsx.
 *
 * Diferente do post de conteúdo (efeito de um único post), aprovar aqui
 * dispara e-mail pra uma LISTA — por isso pede confirmação com a contagem
 * real de destinatários antes de enviar (prévia via
 * /api/marketing-email/campaigns/[id]/audience-preview).
 */
export function EmailCampaignActions({
  campaignId,
  initialSubject,
  initialBodyText,
}: {
  campaignId: string
  initialSubject: string
  initialBodyText: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState<'approve' | 'reject' | 'edit' | 'preview' | null>(null)
  const [editing, setEditing] = useState(false)
  const [subject, setSubject] = useState(initialSubject)
  const [bodyText, setBodyText] = useState(initialBodyText)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [preview, setPreview] = useState<{ total: number; skipped: number } | null>(null)

  async function act(action: 'approve' | 'reject' | 'edit') {
    setPending(action)
    setError(null)
    try {
      const response = await fetch(`/api/marketing-email/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'edit' ? { action, subject, body_text: bodyText } : { action }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao processar a campanha.')
        return
      }
      if (action === 'edit') setEditing(false)
      setConfirming(false)
      router.refresh()
    } catch {
      setError('Erro de rede ao processar a campanha.')
    } finally {
      setPending(null)
    }
  }

  async function askToApprove() {
    setPending('preview')
    setError(null)
    try {
      const response = await fetch(`/api/marketing-email/campaigns/${campaignId}/audience-preview`)
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao calcular a lista de destinatários.')
        return
      }
      setPreview({ total: data.total, skipped: data.skipped })
      setConfirming(true)
    } catch {
      setError('Erro de rede ao calcular a lista de destinatários.')
    } finally {
      setPending(null)
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-2 rounded-xl p-3" style={{ border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.06)' }}>
        <p className="text-xs text-amber-300">
          {preview && preview.total > 0
            ? `Isso enviará o e-mail para ${preview.total} destinatário(s) agora.${preview.skipped > 0 ? ` (${preview.skipped} pulado(s) por opt-out ou sem e-mail.)` : ''}`
            : 'Nenhum destinatário elegível para o segmento escolhido.'}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => act('approve')}
            disabled={pending !== null || !preview || preview.total === 0}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}
          >
            <Send size={12} />
            {pending === 'approve' ? 'Enviando…' : 'Confirmar envio'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={pending !== null}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-300 transition-all hover:bg-white/5 disabled:opacity-50"
            style={{ border: '1px solid rgba(255,255,255,0.1)' }}
          >
            Cancelar
          </button>
        </div>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {editing && (
        <div className="flex w-full min-w-[280px] flex-col gap-2">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto" />
          <Textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={6} />
        </div>
      )}
      <div className="flex gap-2">
        {editing ? (
          <button
            onClick={() => act('edit')}
            disabled={pending !== null}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)' }}
          >
            {pending === 'edit' ? 'Salvando…' : 'Salvar edição'}
          </button>
        ) : (
          <button
            onClick={() => setEditing(true)}
            disabled={pending !== null}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-300 transition-all hover:bg-white/5 disabled:opacity-50"
            style={{ border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <Pencil size={12} /> Editar
          </button>
        )}
        <button
          onClick={askToApprove}
          disabled={pending !== null}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}
          title="Calcula a lista e pede confirmação antes de enviar"
        >
          {pending === 'preview' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Aprovar e enviar
        </button>
        <button
          onClick={() => act('reject')}
          disabled={pending !== null}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-300 transition-all hover:bg-white/5 disabled:opacity-50"
          style={{ border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <X size={12} />
          {pending === 'reject' ? '…' : 'Rejeitar'}
        </button>
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  )
}
