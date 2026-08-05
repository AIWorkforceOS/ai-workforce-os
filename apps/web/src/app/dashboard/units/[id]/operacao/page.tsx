import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CalendarDays, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { ServiceOperationsPanel } from '@/components/dashboard/service-operations-panel'
import type {
  InvoiceWithRelations,
  ServiceRecordWithRelations,
} from '@/components/dashboard/service-operations-panel'
import { unitDefaultLocale } from '@/lib/i18n/config'
import {
  currentMonthInTimezone,
  monthLabel,
  monthRange,
  mostRecentMonth,
  resolveMonthSelection,
  shiftMonth,
} from '@/lib/service-operations-month'
import type { Customer, Employee, Service, Unit } from '@/lib/types'

/**
 * Operação da unidade (migration 030): serviços executados + valores a
 * pagar por profissional + faturas para o cliente final. Fecha o ciclo
 * agenda → execução → pagamento do técnico → cobrança do cliente.
 *
 * force-dynamic: sem isso, os fetch() do supabase-js dentro desta rota
 * (que usa cookies() só pra auth) caem no Data Cache padrão do Next —
 * um cache de servidor que sobrevive a F5, diferente do Router Cache do
 * navegador. Resultado real visto em produção: cliente editava telefone/
 * e-mail/endereço e a tela de Operação/Financeiro continuava mostrando o
 * dado antigo mesmo depois de recarregar a página inteira.
 */
export const dynamic = 'force-dynamic'

export default async function UnitOperationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const { id } = await params
  const { month: monthParam } = await searchParams
  const supabase = await createClient()

  const { data: unit } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unit) notFound()
  const unitRow = unit as Unit

  const currentMonth = currentMonthInTimezone(unitRow.timezone)
  const monthSelection = resolveMonthSelection(monthParam, unitRow.timezone)
  const isAllMonths = monthSelection === 'all'
  /** mês usado pra novos lançamentos (reference_month/data padrão) — em "todo o histórico" cai no mês atual, igual ao comportamento de sempre. */
  const selectedMonth = isAllMonths ? currentMonth : monthSelection
  const isCurrentMonth = selectedMonth === currentMonth
  const locale = unitDefaultLocale(unitRow) === 'en' ? 'en-US' : 'pt-BR'
  const selectedMonthLabel = monthLabel(selectedMonth, locale)
  const viewLabel = isAllMonths ? 'Todo o histórico' : selectedMonthLabel

  let recordsQuery = supabase
    .from('service_records')
    .select('*, employee:employees(id,name), customer:customers(id,name,email), service:services(id,name)')
    .eq('unit_id', id)
  let invoicesQuery = supabase.from('invoices').select('*, customer:customers(id,name,email,phone)').eq('unit_id', id)

  if (!isAllMonths) {
    const { start: monthStart, nextStart: monthNextStart } = monthRange(selectedMonth)
    recordsQuery = recordsQuery.gte('service_date', monthStart).lt('service_date', monthNextStart)
    invoicesQuery = invoicesQuery.gte('reference_month', monthStart).lt('reference_month', monthNextStart)
  }

  // "Todo o histórico" não tem o filtro de mês pra limitar o resultado, então
  // o teto de segurança é bem maior — não deve ser atingido em uso normal.
  const rowLimit = isAllMonths ? 5000 : 1000

  const [{ data: employees }, { data: services }, { data: customers }, { data: records }, { data: invoices }] =
    await Promise.all([
      supabase.from('employees').select('*').eq('unit_id', id).eq('is_active', true).order('name'),
      supabase.from('services').select('*').eq('unit_id', id).eq('is_active', true).order('name'),
      supabase.from('customers').select('id, name, email, phone, address, custom_fields').eq('unit_id', id).eq('status', 'active').order('name').limit(500),
      recordsQuery
        .order('service_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(rowLimit),
      invoicesQuery.order('created_at', { ascending: false }).limit(rowLimit),
    ])

  const recordsList = records ?? []
  const invoicesList = invoices ?? []

  // Mês atual (padrão da tela) veio vazio — em vez de parecer que os dados
  // sumiram, sugere direto o mês mais recente que realmente tem histórico.
  let suggestedMonth: string | null = null
  if (!isAllMonths && isCurrentMonth && recordsList.length === 0 && invoicesList.length === 0) {
    const [{ data: lastRecord }, { data: lastInvoice }] = await Promise.all([
      supabase
        .from('service_records')
        .select('service_date')
        .eq('unit_id', id)
        .order('service_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('invoices')
        .select('reference_month')
        .eq('unit_id', id)
        .order('reference_month', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    suggestedMonth = mostRecentMonth([lastRecord?.service_date, lastInvoice?.reference_month])
  }
  const suggestedMonthLabel = suggestedMonth ? monthLabel(suggestedMonth, locale) : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="operação"
        title={`Operação — ${unitRow.name}`}
        subtitle={
          isAllMonths
            ? 'Mostrando todo o histórico, sem filtro de mês — nenhum lançamento antigo foi apagado.'
            : isCurrentMonth
              ? `Serviços executados, valores a pagar por profissional e faturas para seus clientes — ${selectedMonthLabel}.`
              : `Mostrando ${selectedMonthLabel} — lançamentos desse mês, com edição, cobrança e baixa liberadas normalmente.`
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <form method="get" className="flex items-center gap-1.5">
              {isAllMonths ? (
                <span
                  className="rounded-xl px-3 py-2 text-xs font-bold text-cyan-300"
                  style={{ border: '1px solid rgba(6,182,212,0.3)', background: 'rgba(6,182,212,0.08)' }}
                >
                  Todos os meses
                </span>
              ) : (
                <>
                  <Link
                    href={`?month=${shiftMonth(selectedMonth, -1)}`}
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition-all hover:bg-white/5"
                    style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                    aria-label="Mês anterior"
                  >
                    <ChevronLeft size={14} />
                  </Link>
                  <input
                    type="month"
                    name="month"
                    defaultValue={selectedMonth}
                    className="rounded-xl bg-transparent px-3 py-2 text-xs font-bold text-white [color-scheme:dark]"
                    style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                  />
                  <button
                    type="submit"
                    className="rounded-xl px-3 py-2 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                    style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
                  >
                    Ir
                  </button>
                  <Link
                    href={`?month=${shiftMonth(selectedMonth, 1)}`}
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition-all hover:bg-white/5"
                    style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                    aria-label="Próximo mês"
                  >
                    <ChevronRight size={14} />
                  </Link>
                  {!isCurrentMonth && (
                    <Link
                      href="?"
                      className="rounded-xl px-3 py-2 text-xs font-bold text-cyan-300 transition-all hover:bg-white/5"
                      style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                      Mês atual
                    </Link>
                  )}
                </>
              )}
              <Link
                href={isAllMonths ? `?month=${currentMonth}` : '?month=all'}
                className="rounded-xl px-3 py-2 text-xs font-bold text-cyan-300 transition-all hover:bg-white/5"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                {isAllMonths ? 'Ver mês a mês' : 'Todos os meses'}
              </Link>
            </form>
            <Link
              href="/dashboard/employees"
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Users size={13} />
              Equipe
            </Link>
            <Link
              href={`/dashboard/units/${id}/agenda/calendario`}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <CalendarDays size={13} />
              Calendário
            </Link>
          </div>
        }
      />

      {/* Indicador grande e sempre visível de qual recorte está sendo
          mostrado — pedido urgente do dono do produto depois que o mês
          atual (agosto) veio vazio por padrão e pareceu que julho tinha
          sumido. Nenhum dado é apagado; isso só deixa óbvio o filtro. */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4"
        style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)' }}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-cyan-300">Mostrando</span>
          <span className="text-lg font-black capitalize text-white">{viewLabel}</span>
          {!isAllMonths && isCurrentMonth && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold text-cyan-300"
              style={{ background: 'rgba(6,182,212,0.15)' }}
            >
              mês atual
            </span>
          )}
        </div>
        <Link
          href={isAllMonths ? `?month=${currentMonth}` : '?month=all'}
          className="rounded-xl px-3 py-1.5 text-xs font-bold text-cyan-300 transition-all hover:bg-white/5"
          style={{ border: '1px solid rgba(6,182,212,0.3)' }}
        >
          {isAllMonths ? 'Ver mês a mês' : 'Ver todo o histórico'}
        </Link>
      </div>

      {suggestedMonth && suggestedMonthLabel && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 text-sm"
          style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)' }}
        >
          <p className="text-blue-200">
            <strong className="capitalize">{selectedMonthLabel}</strong> ainda não tem lançamentos.
          </p>
          <Link
            href={`?month=${suggestedMonth}`}
            className="rounded-xl px-3 py-1.5 text-xs font-bold text-blue-300 transition-all hover:bg-white/5"
            style={{ border: '1px solid rgba(59,130,246,0.3)' }}
          >
            Ver {suggestedMonthLabel} →
          </Link>
        </div>
      )}

      {unitRow.org_id ? (
        <ServiceOperationsPanel
          unitId={unitRow.id}
          orgId={unitRow.org_id}
          timezone={unitRow.timezone}
          currency={unitDefaultLocale(unitRow) === 'en' ? 'USD' : 'BRL'}
          selectedMonth={selectedMonth}
          isCurrentMonth={isCurrentMonth}
          isAllMonths={isAllMonths}
          selectedMonthLabel={selectedMonthLabel}
          employees={(employees ?? []) as Employee[]}
          services={(services ?? []) as Service[]}
          customers={(customers ?? []) as Pick<Customer, 'id' | 'name' | 'email' | 'phone' | 'address' | 'custom_fields'>[]}
          initialRecords={(records ?? []) as unknown as ServiceRecordWithRelations[]}
          initialInvoices={(invoices ?? []) as unknown as InvoiceWithRelations[]}
          initialBilling={{
            billing_company_name: unitRow.billing_company_name,
            billing_address: unitRow.billing_address,
            billing_email: unitRow.billing_email,
            billing_phone: unitRow.billing_phone,
            billing_payment_instructions: unitRow.billing_payment_instructions,
            logo_url: unitRow.logo_url,
          }}
        />
      ) : (
        <p className="text-sm text-amber-400">
          Esta unidade não está vinculada a uma empresa (org_id vazio) — a Operação exige esse vínculo.
        </p>
      )}
    </div>
  )
}
