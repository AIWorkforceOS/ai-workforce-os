'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Pencil, X } from 'lucide-react'
import { Textarea } from '@/components/ui/dashboard-ui'

/**
 * Ações humanas sobre um post pendente de aprovação: aprovar, rejeitar, ou
 * editar a legenda antes de decidir — mesmo espírito de
 * traffic-decision-actions.tsx. Aprovar publica na hora SÓ quando o post é
 * pra hoje; um post do planejamento semanal (scheduledFor no futuro) só
 * marca aprovado e espera o cron publicar no dia certo (pedido do
 * Vinicius, 2026-08-23) — o texto do botão avisa qual dos dois vai acontecer.
 */
export function ContentPostActions({
  postId,
  initialCaption,
  scheduledFor,
}: {
  postId: string
  initialCaption: string
  scheduledFor?: string | null
}) {
  // Mesmo corte de "futuro" usado no backend (api/content/posts/[id]/route.ts): depois do fim do dia de hoje.
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  const isFutureScheduled = Boolean(scheduledFor && new Date(scheduledFor).getTime() > endOfToday.getTime())
  const router = useRouter()
  const [pending, setPending] = useState<'approve' | 'reject' | 'edit' | null>(null)
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(initialCaption)
  const [error, setError] = useState<string | null>(null)

  async function act(action: 'approve' | 'reject' | 'edit') {
    setPending(action)
    setError(null)
    try {
      const response = await fetch(`/api/content/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'edit' ? { action, caption } : { action }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao processar o post.')
        return
      }
      if (action === 'edit') setEditing(false)
      router.refresh()
    } catch {
      setError('Erro de rede ao processar o post.')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {editing && (
        <Textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={4}
          className="w-full min-w-[240px]"
        />
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
          onClick={() => act('approve')}
          disabled={pending !== null}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}
          title={
            isFutureScheduled
              ? `Aprova — publica sozinho no dia agendado (${new Date(scheduledFor!).toLocaleDateString('pt-BR')})`
              : 'Aprova e publica o post agora'
          }
        >
          <Check size={12} />
          {pending === 'approve' ? (isFutureScheduled ? 'Aprovando…' : 'Publicando…') : isFutureScheduled ? 'Aprovar' : 'Aprovar e publicar'}
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
