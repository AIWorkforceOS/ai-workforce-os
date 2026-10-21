'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** Super admin Alizo: libera/retira o direito de um administrador trocar a logo da própria empresa. */
export function BrandingAccessToggle({ userId, enabled }: { userId: string; enabled: boolean }) {
  const router = useRouter()
  const [on, setOn] = useState(enabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (busy) return
    const next = !on
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/users/branding-access', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, enabled: next }) })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (response.ok) {
        setOn(next)
        router.refresh()
      } else setError(data?.error ?? 'Não foi possível salvar.')
    } catch {
      setError('Sem conexão.')
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" role="switch" aria-checked={on} onClick={() => void toggle()} disabled={busy} className="inline-flex w-fit items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-bold disabled:opacity-60" style={{ background: on ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)', border: `1px solid ${on ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.15)'}`, color: on ? '#6ee7b7' : '#cbd5e1' }}>
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: on ? '#10b981' : '#64748b' }} />
        {on ? 'Pode trocar a logo' : 'Não pode trocar a logo'}
      </button>
      {error && <span role="alert" className="text-[11px] text-red-400">{error}</span>}
    </div>
  )
}
