/**
 * Utilitários de mês de referência da tela de Operação da unidade
 * (migration 052): seletor de mês/ano pra não misturar lançamentos de
 * meses diferentes (ex.: julho e agosto/2026).
 *
 * service_records usa o campo que já existia, service_date (dia da
 * execução do serviço). invoices ganhou a coluna nova reference_month
 * — ver comentário da migration 052 pra por que created_at/due_date
 * não serviam pra isso.
 */

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/** 'YYYY-MM-DD' de hoje no fuso da unidade (en-CA formata exatamente assim). */
export function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
}

/** 'YYYY-MM' do mês atual no fuso da unidade. */
export function currentMonthInTimezone(timezone: string): string {
  return todayInTimezone(timezone).slice(0, 7)
}

/** Valida o parâmetro ?month= — ausente ou inválido cai no mês atual da unidade. */
export function resolveSelectedMonth(raw: string | undefined, timezone: string): string {
  if (raw && MONTH_PATTERN.test(raw)) return raw
  return currentMonthInTimezone(timezone)
}

/**
 * 'all' = visão "todo o histórico" sem filtro de mês (?month=all); usada
 * pra deixar óbvio que nenhum lançamento antigo foi apagado — o dono do
 * produto se assustou ao ver agosto vazio por padrão e achar que julho
 * tinha sumido. Qualquer outro valor cai em resolveSelectedMonth().
 */
export type MonthSelection = 'all' | string

export function resolveMonthSelection(raw: string | undefined, timezone: string): MonthSelection {
  if (raw === 'all') return 'all'
  return resolveSelectedMonth(raw, timezone)
}

/**
 * O mês mais recente entre datas 'YYYY-MM-DD' (ou já 'YYYY-MM')
 * possivelmente nulas — usado pra sugerir "agosto ainda não tem
 * lançamentos, ver julho" quando o mês atual (selecionado por padrão)
 * está vazio mas existe histórico em outro mês.
 */
export function mostRecentMonth(dates: (string | null | undefined)[]): string | null {
  const months = dates.filter((d): d is string => Boolean(d)).map((d) => d.slice(0, 7))
  if (months.length === 0) return null
  return months.reduce((max, m) => (m > max ? m : max))
}

/**
 * [início do mês, início do mês seguinte) em 'YYYY-MM-DD' — faixa
 * meia-aberta pronta pra filtrar colunas date/timestamptz com
 * gte(start).lt(nextStart), sem depender de "último dia do mês".
 */
export function monthRange(month: string): { start: string; nextStart: string } {
  const [year = 0, mon = 1] = month.split('-').map(Number)
  const start = `${month}-01`
  const next = new Date(Date.UTC(year, mon, 1)) // mon (1-indexado) já cai no mês seguinte em índice 0-indexado
  const nextStart = next.toISOString().slice(0, 10)
  return { start, nextStart }
}

/** Mês anterior/seguinte (delta em meses, positivo ou negativo) como 'YYYY-MM'. */
export function shiftMonth(month: string, delta: number): string {
  const [year = 0, mon = 1] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Data padrão pra um novo lançamento: hoje, se o mês selecionado é o
 * atual (comportamento idêntico ao de antes do seletor existir). Senão,
 * o mesmo dia-do-mês de hoje dentro do mês selecionado (ajustado pro
 * último dia se o mês selecionado for mais curto) — o lançamento nasce
 * dentro do mês que o usuário está navegando, sem precisar digitar a
 * data toda vez que ele está preenchendo dados atrasados de um mês
 * passado.
 */
export function defaultDateForMonth(selectedMonth: string, timezone: string): string {
  const today = todayInTimezone(timezone)
  if (today.slice(0, 7) === selectedMonth) return today
  const day = Number(today.slice(8, 10))
  const [year = 0, mon = 1] = selectedMonth.split('-').map(Number)
  const lastDay = new Date(year, mon, 0).getDate()
  return `${selectedMonth}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

const monthLabelFormatters = new Map<string, Intl.DateTimeFormat>()

/** Rótulo legível do mês num locale dado (ex.: "julho de 2026"). */
export function monthLabel(month: string, locale: string): string {
  let formatter = monthLabelFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    monthLabelFormatters.set(locale, formatter)
  }
  const [year = 0, mon = 1] = month.split('-').map(Number)
  return formatter.format(new Date(Date.UTC(year, mon - 1, 1)))
}
