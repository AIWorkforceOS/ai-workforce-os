'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/dashboard-ui'
import {
  canInvoiceSelection,
  dueFromTerms,
  groupByClient,
  monthSummary,
  NET_TERM_SHORTCUTS,
  REMINDER_LABEL,
  remindersFor,
  type BillingRecord,
  type ReminderBucket,
} from '@/lib/billing/by-client'

const BUCKET_STYLE: Record<ReminderBucket, { bg: string; border: string; color: string }> = {
  overdue: { bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.35)', color: '#fca5a5' },
  today: { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', color: '#fcd34d' },
  tomorrow: { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.35)', color: '#93c5fd' },
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function ClientBillingBoard({
  unitId,
  currency,
  today,
  monthLabel,
  initialRecords,
  initialReminderRecords,
  terms,
  operationHref,
}: {
  unitId: string
  currency: string
  today: string
  monthLabel: string
  initialRecords: BillingRecord[]
  initialReminderRecords: BillingRecord[]
  terms: Record<string, number | null>
  operationHref: string
}) {
  const router = useRouter()
  const [records, setRecords] = useState(initialRecords)
  const [reminderRecords, setReminderRecords] = useState(initialReminderRecords)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const money = (n: number) => n.toLocaleString(currency === 'USD' ? 'en-US' : 'pt-BR', { style: 'currency', currency })

  const groups = useMemo(() => groupByClient(records), [records])
  const summary = useMemo(() => monthSummary(records), [records])
  const reminders = useMemo(() => remindersFor(reminderRecords, today), [reminderRecords, today])

  /** Atualiza o registro nas duas listas (mês e lembretes). */
  function patchRecord(id: string, patch: Partial<BillingRecord>) {
    setRecords((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    setReminderRecords((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  async function saveDue(record: BillingRecord, value: string | null) {
    setBusyKey(`due-${record.id}`)
    setMessage(null)
    const { error } = await createClient().from('service_records').update({ due_date: value }).eq('id', record.id)
    setBusyKey(null)
    if (error) return setMessage({ ok: false, text: 'Não foi possível salvar o vencimento.' })
    patchRecord(record.id, { dueDate: value })
  }

  async function generateInvoice(clientKey: string, list: BillingRecord[]) {
    const check = canInvoiceSelection(list)
    if (!check.ok) return setMessage({ ok: false, text: check.reason })
    const total = list.reduce((n, r) => n + (r.amount ?? 0), 0)
    if (!window.confirm(`Gerar UMA invoice para ${check.client} com ${list.length} ordem(ns), total ${money(total)}?`)) return
    setBusyKey(`inv-${clientKey}`)
    setMessage(null)
    const { data, error } = await createClient().rpc('generate_client_invoice', { p_unit_id: unitId, p_client_company: check.client, p_service_record_ids: list.map((r) => r.id), p_currency: currency })
    setBusyKey(null)
    if (error) return setMessage({ ok: false, text: error.message || 'Não foi possível gerar a invoice.' })
    const invoice = data as { id: string; invoice_number: string; status: string }
    for (const r of list) patchRecord(r.id, { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, invoiceStatus: invoice.status })
    setSelected(new Set())
    setMessage({ ok: true, text: `Invoice ${invoice.invoice_number} criada para ${check.client}. Para enviar ao cliente, abra “Operação e faturas”.` })
    router.refresh()
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`rounded-xl px-4 py-3 text-sm font-semibold ${message.ok ? 'text-emerald-300' : 'text-red-300'}`} style={{ background: message.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)' }}>
          {message.text}{' '}
          {message.ok && (
            <Link href={operationHref} className="underline">
              Abrir Operação
            </Link>
          )}
        </p>
      )}

      {/* Lembretes (manuais): o que vence hoje/amanhã e o que já passou — uma invoice por cliente */}
      {reminders.length > 0 && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-sm font-bold text-white">Lembretes de envio de invoice</h2>
          <div className="flex flex-col gap-2">
            {reminders.map((g) => {
              const style = BUCKET_STYLE[g.bucket]
              const key = `${g.bucket}-${g.client}-${g.dueDate}`
              return (
                <div key={key} className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: style.bg, border: `1px solid ${style.border}` }}>
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide" style={{ color: style.color }}>
                      {REMINDER_LABEL[g.bucket]} · {fmtDate(g.dueDate)}
                    </p>
                    <p className="text-sm font-bold text-white">
                      {g.client} — {g.records.length} ordem(ns) · {money(g.total)}
                    </p>
                  </div>
                  <button type="button" disabled={busyKey === `inv-${key}`} onClick={() => void generateInvoice(key, g.records)} className="rounded-xl px-3 py-2 text-xs font-bold text-white disabled:opacity-60" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
                    {busyKey === `inv-${key}` ? 'Gerando…' : 'Gerar invoice deste cliente'}
                  </button>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {groups.length === 0 && <p className="text-sm text-slate-400">Nenhuma ordem lançada em {monthLabel}.</p>}

      {/* Um bloco por cliente */}
      {groups.map((group) => {
        const termDays = terms[group.client.trim().toLowerCase()] ?? null
        const selectedHere = group.records.filter((r) => selected.has(r.id))
        const clientKey = `client-${group.client}`
        return (
          <Card key={group.client} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div>
                <h2 className="text-base font-black text-white">{group.client}</h2>
                <p className="text-xs text-slate-400">
                  {group.totals.count} ordem(ns){termDays != null ? ` · prazo padrão Net ${termDays}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-4 text-right text-xs">
                <span>
                  <span className="block text-slate-500">Total</span>
                  <strong className="text-sm text-white">{money(group.totals.total)}</strong>
                </span>
                <span>
                  <span className="block text-slate-500">A faturar</span>
                  <strong className="text-sm text-amber-300">{money(group.totals.toBill)}</strong>
                </span>
                <span>
                  <span className="block text-slate-500">Faturado</span>
                  <strong className="text-sm text-cyan-300">{money(group.totals.billed)}</strong>
                </span>
                <span>
                  <span className="block text-slate-500">Recebido</span>
                  <strong className="text-sm text-emerald-300">{money(group.totals.paid)}</strong>
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="w-10 px-4 py-2" />
                    <th className="px-2 py-2">Serviço</th>
                    <th className="px-2 py-2">Ordem / local</th>
                    <th className="px-2 py-2 text-right">Valor</th>
                    <th className="px-2 py-2">Vencimento</th>
                    <th className="px-2 py-2">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {group.records.map((r) => {
                    const billed = Boolean(r.invoiceId)
                    return (
                      <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <td className="px-4 py-2">{!billed && r.amount != null && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label="Selecionar ordem" />}</td>
                        <td className="px-2 py-2 text-slate-300">{fmtDate(r.serviceDate)}</td>
                        <td className="px-2 py-2 text-slate-300">
                          <span className="font-semibold text-white">{r.orderNumber ? `#${r.orderNumber}` : r.description ?? '—'}</span>
                          {r.locationName && <span className="block text-[11px] text-slate-500">{r.locationName}</span>}
                        </td>
                        <td className="px-2 py-2 text-right font-semibold text-white">{r.amount == null ? '—' : money(r.amount)}</td>
                        <td className="px-2 py-2">
                          {billed ? (
                            <span className="text-slate-400">{fmtDate(r.dueDate)}</span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1">
                              <input type="date" value={r.dueDate ?? ''} disabled={busyKey === `due-${r.id}`} onChange={(e) => void saveDue(r, e.target.value || null)} className="rounded-lg bg-[#0b0f1a] px-2 py-1 text-xs text-white" style={{ border: '1px solid rgba(255,255,255,0.12)' }} aria-label="Vencimento" />
                              {NET_TERM_SHORTCUTS.map((days) => (
                                <button key={days} type="button" onClick={() => void saveDue(r, dueFromTerms(r.serviceDate, days))} className="rounded-md px-1.5 py-1 text-[10px] font-bold text-slate-200 hover:text-white" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }} title={`Net ${days}: serviço + ${days} dias`}>
                                  Net {days}
                                </button>
                              ))}
                              {termDays != null && !NET_TERM_SHORTCUTS.includes(termDays as never) && (
                                <button type="button" onClick={() => void saveDue(r, dueFromTerms(r.serviceDate, termDays))} className="rounded-md px-1.5 py-1 text-[10px] font-bold text-cyan-200" style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)' }}>
                                  Net {termDays}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {r.paid ? <span className="font-bold text-emerald-300">Recebida</span> : billed ? <span className="font-bold text-cyan-300">{r.invoiceNumber ?? 'Faturada'}</span> : <span className="font-bold text-amber-300">A faturar</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-xs text-slate-400">
                {selectedHere.length > 0 ? `${selectedHere.length} ordem(ns) selecionada(s) · ${money(selectedHere.reduce((n, r) => n + (r.amount ?? 0), 0))}` : 'Marque as ordens que entram na invoice deste cliente.'}
              </p>
              <button type="button" disabled={selectedHere.length === 0 || busyKey === `inv-${clientKey}`} onClick={() => void generateInvoice(clientKey, selectedHere)} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
                {busyKey === `inv-${clientKey}` ? 'Gerando…' : 'Gerar invoice com as selecionadas'}
              </button>
            </div>
          </Card>
        )
      })}

      {/* Total do mês — sempre embaixo */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 className="text-base font-black text-white">Total faturamento — {monthLabel}</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-4">
          <Stat label="Total do mês" value={money(summary.totals.total)} color="text-white" />
          <Stat label="A faturar" value={money(summary.totals.toBill)} color="text-amber-300" />
          <Stat label="Faturado" value={money(summary.totals.billed)} color="text-cyan-300" />
          <Stat label="Recebido" value={money(summary.totals.paid)} color="text-emerald-300" />
        </div>
        {summary.byClient.length > 0 && (
          <div className="overflow-x-auto px-5 pb-4">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-2">Cliente</th>
                  <th className="py-2 text-right">Ordens</th>
                  <th className="py-2 text-right">Total</th>
                  <th className="py-2 text-right">A faturar</th>
                </tr>
              </thead>
              <tbody>
                {summary.byClient.map((c) => (
                  <tr key={c.client} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td className="py-2 font-semibold text-white">{c.client}</td>
                    <td className="py-2 text-right text-slate-300">{c.totals.count}</td>
                    <td className="py-2 text-right text-white">{money(c.totals.total)}</td>
                    <td className="py-2 text-right text-amber-300">{money(c.totals.toBill)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-xl font-black ${color}`}>{value}</p>
    </div>
  )
}
