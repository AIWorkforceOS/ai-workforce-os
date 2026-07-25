'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { GbpChecklistItem } from '@/lib/seo/gbp-checklist'

/**
 * Checklist guiado de Google Business Profile: SEM integração/API real
 * (ver nota da migration 042) — o dono da empresa marca aqui o que já
 * fez manualmente no perfil dele. Estado grava direto via Supabase
 * client (RLS já garante can_access_unit + is_org_admin).
 */
export function SeoGbpChecklist({
  unitId,
  items,
  doneKeys,
}: {
  unitId: string
  items: GbpChecklistItem[]
  doneKeys: string[]
}) {
  const router = useRouter()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [doneSet, setDoneSet] = useState(new Set(doneKeys))

  async function toggle(itemKey: string) {
    setPendingKey(itemKey)
    const nextDone = !doneSet.has(itemKey)
    const supabase = createClient()
    const { error } = await supabase
      .from('seo_gbp_checklist_state')
      .upsert({ unit_id: unitId, item_key: itemKey, is_done: nextDone }, { onConflict: 'unit_id,item_key' })
    setPendingKey(null)
    if (error) return
    setDoneSet((prev) => {
      const next = new Set(prev)
      if (nextDone) next.add(itemKey)
      else next.delete(itemKey)
      return next
    })
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        const done = doneSet.has(item.key)
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => toggle(item.key)}
            disabled={pendingKey === item.key}
            className="flex items-start gap-3 rounded-xl p-3 text-left transition-colors hover:bg-white/[0.03] disabled:opacity-60"
            style={{ border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <span
              className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md"
              style={done ? { background: 'rgba(34,197,94,0.2)', color: '#4ade80' } : { border: '1px solid rgba(255,255,255,0.15)' }}
            >
              {done && <Check size={12} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-xs font-bold ${done ? 'text-slate-500 line-through decoration-slate-600' : 'text-slate-200'}`}>{item.label}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{item.description}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
