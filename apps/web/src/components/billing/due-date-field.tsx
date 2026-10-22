'use client'

import { dueFromTerms, NET_TERM_SHORTCUTS } from '@/lib/billing/by-client'

/**
 * Vencimento da ordem (data de envio/cobrança da invoice): data livre ou atalhos Net 15/30/45/60 (serviço + N dias); se o cliente tem um prazo
 * padrão diferente dos atalhos, aparece um botão extra com ele.
 */
export function DueDateField({ id, value, baseDate, termDays, onChange }: { id?: string; value: string; baseDate: string; termDays?: number | null; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-slate-300">
        Vencimento (envio da invoice)
      </label>
      <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl bg-[#0b0f1a] px-3 py-2 text-sm text-white" style={{ border: '1px solid rgba(255,255,255,0.12)' }} />
      <div className="flex flex-wrap gap-1">
        {NET_TERM_SHORTCUTS.map((days) => (
          <button key={days} type="button" onClick={() => onChange(dueFromTerms(baseDate, days) ?? '')} className="rounded-md px-2 py-1 text-[11px] font-bold text-slate-200 hover:text-white" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }} title={`Net ${days}: serviço + ${days} dias`}>
            Net {days}
          </button>
        ))}
        {termDays != null && !NET_TERM_SHORTCUTS.includes(termDays as never) && (
          <button type="button" onClick={() => onChange(dueFromTerms(baseDate, termDays) ?? '')} className="rounded-md px-2 py-1 text-[11px] font-bold text-cyan-200" style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)' }}>
            Padrão do cliente: Net {termDays}
          </button>
        )}
        {value && (
          <button type="button" onClick={() => onChange('')} className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-400 underline">
            Limpar
          </button>
        )}
      </div>
    </div>
  )
}
