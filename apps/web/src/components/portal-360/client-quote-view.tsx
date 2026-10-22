import { Badge, Card } from '@/components/ui/dashboard-ui'
import { formatUsd } from '@/lib/portal-360/dashboard'
import { lineTotal, quoteTotals, type QuoteItem } from '@/lib/portal-360/quote'
import { QuoteDecisionPanel } from './quote-decision-panel'

/**
 * Cotação como o CLIENTE vê (sempre em inglês, sem nada em português): descrição, material item a item com quantidade e preço, horas, total e
 * comparação com o que ele já tinha aprovado — e os botões de aprovar/recusar.
 */
export function ClientQuoteView({
  appointmentId,
  description,
  items,
  materialValue,
  hoursNeeded,
  partLink,
  approvedAmount,
  approvedHours,
  decision,
  decidedAt,
  stageLabel,
}: {
  appointmentId: string
  description: string | null
  items: QuoteItem[]
  materialValue: number | null
  hoursNeeded: number | null
  partLink: string | null
  approvedAmount: number | null
  approvedHours: number | null
  decision: string | null
  decidedAt: string | null
  stageLabel: string
}) {
  const totals = quoteTotals({ items, materialValue, hoursNeeded, approvedAmount, approvedHours })
  const hasNumbers = totals.hasItems || materialValue != null || hoursNeeded != null
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Quote</p>
        <Badge variant={decision === 'approved' ? 'green' : decision === 'rejected' ? 'red' : 'purple'}>{stageLabel}</Badge>
      </div>

      {description ? <p className="whitespace-pre-wrap text-sm text-slate-200">{description}</p> : <p className="text-sm text-slate-400">Mawi is preparing the full quote description. The amounts below are what we have so far.</p>}

      {hasNumbers && (
        <div className="mt-4 overflow-x-auto rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2.5">Material</th>
                <th className="px-4 py-2.5 text-right">Qty</th>
                <th className="px-4 py-2.5 text-right">Unit price</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {totals.hasItems ? (
                items.map((item, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                    <td className="px-4 py-2.5 text-slate-200">{item.description}</td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{item.quantity}</td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{formatUsd(item.unitPrice)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-white">{formatUsd(lineTotal(item))}</td>
                  </tr>
                ))
              ) : (
                <tr className="border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <td className="px-4 py-2.5 text-slate-200" colSpan={3}>
                    Materials (total)
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-white">{formatUsd(totals.materials)}</td>
                </tr>
              )}
              <tr className="border-t" style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
                <td className="px-4 py-2.5 font-bold text-white" colSpan={3}>
                  Materials total
                </td>
                <td className="px-4 py-2.5 text-right font-black text-white">{formatUsd(totals.materials)}</td>
              </tr>
              {totals.hours != null && (
                <tr className="border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <td className="px-4 py-2.5 text-slate-200" colSpan={3}>
                    Estimated labor time
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-white">{totals.hours} h</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(approvedAmount != null || approvedHours != null) && hasNumbers && (
        <div className="mt-3 rounded-xl px-4 py-3 text-xs text-slate-300" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <p className="font-bold text-slate-200">Compared with what you had already approved</p>
          {approvedAmount != null && totals.overApprovedAmount != null && (
            <p className="mt-1">
              Amount: approved {formatUsd(approvedAmount)} → this quote {formatUsd(totals.materials)}{' '}
              <span className={totals.overApprovedAmount > 0 ? 'font-bold text-amber-300' : 'font-bold text-emerald-400'}>
                ({totals.overApprovedAmount > 0 ? '+' : ''}
                {formatUsd(totals.overApprovedAmount)})
              </span>
            </p>
          )}
          {approvedHours != null && totals.overApprovedHours != null && (
            <p className="mt-1">
              Time: approved {approvedHours} h → this quote {totals.hours} h{' '}
              <span className={totals.overApprovedHours > 0 ? 'font-bold text-amber-300' : 'font-bold text-emerald-400'}>
                ({totals.overApprovedHours > 0 ? '+' : ''}
                {totals.overApprovedHours} h)
              </span>
            </p>
          )}
        </div>
      )}

      {partLink && (
        <p className="mt-3 text-xs">
          <a href={partLink} target="_blank" rel="noopener noreferrer" className="font-semibold text-cyan-400 hover:underline">
            View the part / material link
          </a>
        </p>
      )}

      <div className="mt-5 border-t pt-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <QuoteDecisionPanel appointmentId={appointmentId} decision={decision} decidedAt={decidedAt} />
      </div>
    </Card>
  )
}
