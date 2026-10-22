import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ChevronRight, Wallet } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { ClientBillingBoard } from '@/components/billing/client-billing-board'
import { fetchBillingRecords, fetchReminderRecords } from '@/lib/billing/queries'
import { currentMonthInTimezone, monthLabel, resolveSelectedMonth, shiftMonth, todayInTimezone } from '@/lib/service-operations-month'
import { unitDefaultLocale } from '@/lib/i18n/config'
import { normalizeClientName } from '@/lib/client-profiles/profile'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Faturamento por cliente (Facility): as ordens do mês separadas por cliente, vencimento de cada ordem (Net 15/30/45/60 ou livre),
 * lembretes de "vence hoje/amanhã" para enviar a invoice e UMA invoice por cliente. O total do mês fica embaixo.
 */
export default async function UnitBillingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  const { id } = await params
  const { month: monthParam } = await searchParams
  const supabase = await createClient()
  const { data: unit } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unit) notFound()
  const unitRow = unit as Unit

  const today = todayInTimezone(unitRow.timezone)
  const currentMonth = currentMonthInTimezone(unitRow.timezone)
  const month = resolveSelectedMonth(monthParam, unitRow.timezone)
  const locale = unitDefaultLocale(unitRow) === 'en' ? 'en-US' : 'pt-BR'
  const currency = unitDefaultLocale(unitRow) === 'en' ? 'USD' : 'BRL'
  const monthOptions = Array.from({ length: 26 }, (_, i) => shiftMonth(currentMonth, 1 - i))

  const [{ records, error }, reminders, { data: profiles }] = await Promise.all([
    fetchBillingRecords(supabase, id, month),
    fetchReminderRecords(supabase, id, today),
    supabase.from('client_company_profiles').select('name, payment_terms_days').eq('org_id', unitRow.org_id ?? ''),
  ])
  const terms: Record<string, number | null> = {}
  for (const p of (profiles ?? []) as { name: string; payment_terms_days: number | null }[]) terms[normalizeClientName(p.name).toLowerCase()] = p.payment_terms_days

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="financeiro"
        title={`Faturamento por cliente — ${unitRow.name}`}
        subtitle={`Ordens de ${monthLabel(month, locale)} separadas por cliente, com vencimento por ordem e uma invoice para cada cliente.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <a href={`?month=${shiftMonth(month, -1)}`} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.08)' }} aria-label="Mês anterior">
              <ChevronLeft size={14} />
            </a>
            <form method="get" className="flex items-center gap-1.5">
              <select name="month" defaultValue={month} className="rounded-xl bg-[#0b0f1a] px-3 py-2 text-xs font-bold text-white" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                {monthOptions.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m, locale)}
                  </option>
                ))}
              </select>
              <button type="submit" className="rounded-xl px-3 py-2 text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}>
                Ir
              </button>
            </form>
            <a href={`?month=${shiftMonth(month, 1)}`} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.08)' }} aria-label="Próximo mês">
              <ChevronRight size={14} />
            </a>
            <Link href={`/dashboard/units/${id}/operacao?month=${month}`} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-cyan-300 hover:bg-white/5" style={{ border: '1px solid rgba(6,182,212,0.3)' }}>
              <Wallet size={13} />
              Operação e faturas
            </Link>
          </div>
        }
      />
      {error ? (
        <p className="rounded-xl p-4 text-sm text-amber-300" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
          O faturamento por cliente ainda não está disponível nesta base. Fale com a equipe Alizo.
        </p>
      ) : (
        <ClientBillingBoard key={month} unitId={id} currency={currency} today={today} monthLabel={monthLabel(month, locale)} initialRecords={records} initialReminderRecords={reminders} terms={terms} operationHref={`/dashboard/units/${id}/operacao?month=${month}`} />
      )}
    </div>
  )
}
