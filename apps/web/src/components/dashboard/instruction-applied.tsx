import { Target } from 'lucide-react'

/** Prova de que uma instrução operacional guiou o post: objetivo, por que o formato serve a ele e a chamada para ação usada. */
export function InstructionApplied({ objective, formatReason, cta }: { objective: string | null | undefined; formatReason?: string | null; cta?: string | null }) {
  if (!objective) return null
  return (
    <div className="mt-2 rounded-lg px-3 py-2 text-[11px] leading-relaxed text-slate-300" style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)' }}>
      <p className="flex items-center gap-1.5 font-bold text-cyan-300">
        <Target size={12} /> Instrução aplicada
      </p>
      <p>
        <span className="text-slate-500">Objetivo:</span> {objective}
      </p>
      {formatReason && (
        <p>
          <span className="text-slate-500">Por que este formato:</span> {formatReason}
        </p>
      )}
      {cta && (
        <p>
          <span className="text-slate-500">Chamada para ação:</span> {cta}
        </p>
      )}
    </div>
  )
}
