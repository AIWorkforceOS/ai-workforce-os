'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/dashboard-ui'

export type TrackedKeywordRow = {
  id: string
  keyword: string
  latestPosition: number | null
  latestCheckedAt: string | null
}

/**
 * Lista de palavras-chave acompanhadas (rank tracking) + formulário para
 * adicionar/remover — CRUD direto via Supabase client (RLS já garante
 * can_access_unit + is_org_admin, ver migration 042). A consulta de
 * posição em si é feita pelo cron (lib/seo/rank-tracking.ts), não aqui.
 */
export function SeoKeywordTracker({ unitId, orgId, keywords }: { unitId: string; orgId: string; keywords: TrackedKeywordRow[] }) {
  const router = useRouter()
  const [newKeyword, setNewKeyword] = useState('')
  const [busy, setBusy] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function addKeyword() {
    const keyword = newKeyword.trim()
    if (!keyword) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: insertError } = await supabase.from('seo_keywords').insert({ org_id: orgId, unit_id: unitId, keyword })
    setBusy(false)
    if (insertError) {
      setError(insertError.message.includes('duplicate') ? 'Essa palavra-chave já está sendo acompanhada.' : 'Não deu pra adicionar agora.')
      return
    }
    setNewKeyword('')
    router.refresh()
  }

  async function removeKeyword(id: string) {
    setRemovingId(id)
    const supabase = createClient()
    await supabase.from('seo_keywords').delete().eq('id', id)
    setRemovingId(null)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addKeyword()
          }}
          placeholder="Nova palavra-chave para acompanhar"
          className="flex-1"
        />
        <button
          onClick={addKeyword}
          disabled={busy || !newKeyword.trim()}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black text-white disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)' }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Adicionar
        </button>
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {keywords.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhuma palavra-chave sendo acompanhada ainda.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {keywords.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-slate-200">{row.keyword}</p>
                <p className="text-[11px] text-slate-500">
                  {row.latestPosition !== null
                    ? `Posição ${row.latestPosition}${row.latestCheckedAt ? ` · checado em ${new Date(row.latestCheckedAt).toLocaleDateString('pt-BR')}` : ''}`
                    : row.latestCheckedAt
                      ? `Não encontrada entre os resultados verificados · checado em ${new Date(row.latestCheckedAt).toLocaleDateString('pt-BR')}`
                      : 'Ainda sem checagem'}
                </p>
              </div>
              <button
                onClick={() => removeKeyword(row.id)}
                disabled={removingId === row.id}
                className="flex-shrink-0 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/5 hover:text-red-400 disabled:opacity-50"
                title="Parar de acompanhar"
              >
                {removingId === row.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
