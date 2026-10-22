import type { OrderAnalysis } from '@/lib/service-orders/demand-analysis'

/** Leitura da IA guardada na ordem (custom_fields.order_analysis): demanda, material provável e ideia do escopo. Só apoio interno do escritório. */
export function OrderAnalysisCard({ customFields }: { customFields: unknown }) {
  const a = (customFields as { order_analysis?: Partial<OrderAnalysis> } | null)?.order_analysis
  if (!a || a.insufficient || (!a.demandPt && !a.scopeIdeaPt && !(a.materials?.length ?? 0))) return null
  return (
    <div className="flex flex-col gap-1.5 rounded-xl px-3.5 py-3 text-xs text-slate-200" style={{ background: 'rgba(129,140,248,0.06)', border: '1px solid rgba(129,140,248,0.2)' }}>
      <span className="text-[11px] font-black uppercase tracking-wider text-indigo-300">Análise da IA (apoio interno)</span>
      {a.demandPt && (
        <p>
          <span className="font-bold text-white">Demanda: </span>
          {a.demandPt}
        </p>
      )}
      {(a.materials?.length ?? 0) > 0 && (
        <div>
          <p className="font-bold text-white">Material provável (confirmar na visita):</p>
          <ul className="ml-4 list-disc">
            {a.materials!.map((m) => (
              <li key={m.item}>
                {m.item}
                {m.note ? <span className="text-slate-400"> — {m.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {a.scopeIdeaPt && (
        <p>
          <span className="font-bold text-white">Ideia do escopo: </span>
          {a.scopeIdeaPt}
        </p>
      )}
    </div>
  )
}
