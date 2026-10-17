'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { clearSnapshots, countDrafts, countPendingSaves } from '@/lib/portal-funcionario/offline-store'

export function SignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    // Nunca apagamos fila, rascunhos, fotos, vídeos, assinaturas ou marcos pendentes ao sair — só avisamos.
    try {
      const pending = (await countPendingSaves()) + (await countDrafts())
      if (pending > 0 && !window.confirm(`Há ${pending} item(ns) ainda não enviados neste aparelho (fotos, vídeos, assinaturas ou rascunhos). Eles continuam guardados e serão enviados quando você entrar de novo com ESTA conta. Sair mesmo assim?`)) return
      await clearSnapshots() // só a agenda de consulta deste aparelho
    } catch {
      // sem IndexedDB: segue o logout normal
    }
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleSignOut}
      className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
      style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
    >
      <LogOut size={14} />
      Sair
    </button>
  )
}
