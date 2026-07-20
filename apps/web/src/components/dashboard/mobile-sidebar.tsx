'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { useLocale } from '@/lib/i18n/client'
import { Sidebar } from './sidebar'

/**
 * Hambúrguer + drawer da sidebar para telas < lg. Em desktop a sidebar fixa
 * do layout continua sendo usada — aqui nada é renderizado (lg:hidden).
 */
export function MobileSidebar({ userEmail, role = 'admin' }: { userEmail: string; role?: string }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const locale = useLocale()

  // Fecha ao navegar pra outra rota
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Fecha com Esc
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={locale === 'en' ? 'Open menu' : 'Abrir menu'}
        className="-ml-1 rounded-lg p-2 text-slate-300 transition-all hover:bg-white/5 hover:text-white lg:hidden"
      >
        <Menu size={18} />
      </button>

      {/* Portal: o header usa backdrop-filter, que viraria containing block
          do position:fixed e prenderia o drawer dentro dele */}
      {open && createPortal(
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Overlay — fecha ao clicar fora */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(4,7,15,0.7)', backdropFilter: 'blur(2px)' }}
            onClick={() => setOpen(false)}
          />

          {/* Painel do drawer */}
          <div className="absolute inset-y-0 left-0 w-64" style={{ boxShadow: '8px 0 24px rgba(0,0,0,0.5)' }}>
            <Sidebar userEmail={userEmail} role={role} onNavigate={() => setOpen(false)} />
          </div>

          <button
            onClick={() => setOpen(false)}
            aria-label={locale === 'en' ? 'Close menu' : 'Fechar menu'}
            className="absolute left-[272px] top-4 rounded-lg p-2 text-slate-300 transition-all hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
