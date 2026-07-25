'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Pencil, X } from 'lucide-react'
import { Textarea } from '@/components/ui/dashboard-ui'

/**
 * Ações humanas sobre um post pendente de aprovação: aprovar (publica de
 * verdade via /api/content/posts/[id]), rejeitar, ou editar a legenda
 * antes de decidir — mesmo espírito de traffic-decision-actions.tsx.
 */
export function ContentPostActions({ postId, initialCaption }: { postId: string; initialCaption: string }) {
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
          title="Aprova e publica o post agora"
        >
          <Check size={12} />
          {pending === 'approve' ? 'Publicando…' : 'Aprovar e publicar'}
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
