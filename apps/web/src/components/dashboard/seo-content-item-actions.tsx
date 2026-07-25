'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Pencil, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Input, Textarea } from '@/components/ui/dashboard-ui'

/**
 * Ações humanas sobre um item da fila de conteúdo de SEO: aprovar
 * ("pronto, pode usar/colar"), rejeitar, ou editar antes de decidir.
 *
 * Diferente de ContentPostActions (Conteúdo/Social): aqui não existe
 * publicação automática nenhuma — "aprovar" só muda o status para o
 * dono da empresa saber que aquele texto já está pronto para uso. Por
 * isso a escrita vai direto pelo Supabase client (RLS já garante
 * can_access_unit + is_org_admin, ver migration 042), sem precisar de
 * uma rota de API dedicada.
 */
export function SeoContentItemActions({
  itemId,
  initialTitle,
  initialMetaDescription,
  initialBody,
}: {
  itemId: string
  initialTitle: string
  initialMetaDescription: string | null
  initialBody: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState<'approve' | 'reject' | 'edit' | null>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(initialTitle)
  const [metaDescription, setMetaDescription] = useState(initialMetaDescription ?? '')
  const [body, setBody] = useState(initialBody)
  const [error, setError] = useState<string | null>(null)

  async function act(action: 'approve' | 'reject' | 'edit') {
    setPending(action)
    setError(null)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      const updates =
        action === 'edit'
          ? { title: title.trim(), meta_description: metaDescription.trim() || null, body_markdown: body.trim(), decided_by: user?.email ?? null }
          : { status: action === 'approve' ? 'approved' : 'rejected', decided_by: user?.email ?? null }

      const { error: updateError } = await supabase
        .from('seo_content_items')
        .update(updates)
        .eq('id', itemId)
        .in('status', ['pending_approval'])

      if (updateError) {
        setError('Não deu pra processar agora. Tente de novo.')
        return
      }
      if (action === 'edit') setEditing(false)
      router.refresh()
    } catch {
      setError('Erro de rede ao processar o item.')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {editing && (
        <div className="w-full min-w-[260px] space-y-1.5">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" />
          <Input value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} placeholder="Meta description (opcional)" />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="w-full" />
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
          onClick={() => act('approve')}
          disabled={pending !== null}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}
          title="Marca como pronto para usar"
        >
          <Check size={12} />
          {pending === 'approve' ? 'Aprovando…' : 'Aprovar'}
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
