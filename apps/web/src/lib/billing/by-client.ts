/**
 * Faturamento POR CLIENTE (Facility): agrupa as ordens executadas por cliente, soma o mês, controla o vencimento de cada ordem
 * (Net 15/30/45/60 ou data livre) e lista o que vence hoje/amanhã para o administrador enviar a invoice. Lógica pura, testável sem banco.
 */

/** Atalhos de prazo oferecidos ao finalizar a ordem; o prazo é livre (qualquer número de dias). */
export const NET_TERM_SHORTCUTS = [15, 30, 45, 60] as const

export type BillingRecord = {
  id: string
  serviceDate: string // 'YYYY-MM-DD'
  amount: number | null
  dueDate: string | null // 'YYYY-MM-DD'
  invoiceId: string | null
  invoiceNumber: string | null
  invoiceStatus: string | null
  paid: boolean
  clientName: string
  customerName: string | null
  orderNumber: string | null
  locationName: string | null
  description: string | null
}

export const NO_CLIENT_LABEL = 'Sem cliente vinculado'

/** Cliente da ordem: o cliente cadastrado (client_company); sem ele, o nome do cadastro; sem nada, "Sem cliente vinculado". */
export function clientNameOf(customer: { client_company?: string | null; name?: string | null } | null | undefined): string {
  const company = (customer?.client_company ?? '').trim().replace(/\s+/g, ' ')
  if (company) return company
  const name = (customer?.name ?? '').trim()
  return name || NO_CLIENT_LABEL
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Soma dias a uma data 'YYYY-MM-DD' sem depender de fuso (calendário puro). */
export function addDaysIso(iso: string, days: number): string {
  if (!ISO.test(iso)) return iso
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

/** Vencimento sugerido: data de encerramento/serviço + prazo (Net N). Sem prazo válido, nada é sugerido. */
export function dueFromTerms(baseIso: string, days: number | null | undefined): string | null {
  if (days == null || !Number.isFinite(days) || days < 0 || !ISO.test(baseIso)) return null
  return addDaysIso(baseIso, Math.round(days))
}

export type ClientTotals = { count: number; total: number; toBill: number; billed: number; paid: number }

const cents = (n: number) => Math.round(n * 100)
const fromCents = (c: number) => c / 100

export function totalsOf(records: Pick<BillingRecord, 'amount' | 'invoiceId' | 'paid'>[]): ClientTotals {
  let total = 0
  let toBill = 0
  let billed = 0
  let paid = 0
  for (const r of records) {
    const c = cents(r.amount ?? 0)
    total += c
    if (r.invoiceId) billed += c
    else toBill += c
    if (r.paid) paid += c
  }
  return { count: records.length, total: fromCents(total), toBill: fromCents(toBill), billed: fromCents(billed), paid: fromCents(paid) }
}

export type ClientGroup = { client: string; records: BillingRecord[]; totals: ClientTotals }

/** Um grupo por cliente (ordem alfabética; "Sem cliente vinculado" por último); dentro dele, por vencimento e depois por data do serviço. */
export function groupByClient(records: BillingRecord[]): ClientGroup[] {
  const map = new Map<string, BillingRecord[]>()
  for (const r of records) {
    const key = r.clientName
    map.set(key, [...(map.get(key) ?? []), r])
  }
  const cmpDue = (a: BillingRecord, b: BillingRecord) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || a.serviceDate.localeCompare(b.serviceDate)
  return [...map.entries()]
    .sort(([a], [b]) => (a === NO_CLIENT_LABEL ? 1 : b === NO_CLIENT_LABEL ? -1 : a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })))
    .map(([client, list]) => ({ client, records: [...list].sort(cmpDue), totals: totalsOf(list) }))
}

/** Total do mês (todas as ordens) e a divisão por cliente — o "total faturamento do mês" que fica embaixo da tela. */
export function monthSummary(records: BillingRecord[]): { totals: ClientTotals; byClient: { client: string; totals: ClientTotals }[] } {
  return { totals: totalsOf(records), byClient: groupByClient(records).map((g) => ({ client: g.client, totals: g.totals })) }
}

export type ReminderBucket = 'overdue' | 'today' | 'tomorrow'
export type ReminderGroup = { bucket: ReminderBucket; client: string; dueDate: string; records: BillingRecord[]; total: number }

/**
 * Lembretes MANUAIS de envio de invoice: ordens ainda não faturadas cujo vencimento é hoje, amanhã ou já passou. Agrupadas por cliente e
 * por data (cada cliente recebe a sua invoice separada).
 */
export function remindersFor(records: BillingRecord[], todayIso: string): ReminderGroup[] {
  const tomorrow = addDaysIso(todayIso, 1)
  const groups = new Map<string, ReminderGroup>()
  for (const r of records) {
    if (r.invoiceId || !r.dueDate || r.amount == null) continue
    const bucket: ReminderBucket | null = r.dueDate < todayIso ? 'overdue' : r.dueDate === todayIso ? 'today' : r.dueDate === tomorrow ? 'tomorrow' : null
    if (!bucket) continue
    const key = `${bucket}|${r.clientName}|${r.dueDate}`
    const existing = groups.get(key)
    if (existing) {
      existing.records.push(r)
      existing.total = fromCents(cents(existing.total) + cents(r.amount))
    } else groups.set(key, { bucket, client: r.clientName, dueDate: r.dueDate, records: [r], total: r.amount })
  }
  const order: Record<ReminderBucket, number> = { overdue: 0, today: 1, tomorrow: 2 }
  return [...groups.values()].sort((a, b) => order[a.bucket] - order[b.bucket] || a.dueDate.localeCompare(b.dueDate) || a.client.localeCompare(b.client))
}

export const REMINDER_LABEL: Record<ReminderBucket, string> = { overdue: 'Atrasadas', today: 'Vencem hoje', tomorrow: 'Vencem amanhã' }

/** Ordens de uma seleção podem virar UMA invoice? Todas do mesmo cliente, ainda sem fatura e com valor. */
export function canInvoiceSelection(selected: BillingRecord[]): { ok: true; client: string } | { ok: false; reason: string } {
  if (selected.length === 0) return { ok: false, reason: 'Selecione ao menos uma ordem.' }
  const clients = new Set(selected.map((r) => r.clientName))
  if (clients.size > 1) return { ok: false, reason: 'Cada cliente recebe a sua invoice: selecione ordens de um cliente só.' }
  if (selected.some((r) => r.invoiceId)) return { ok: false, reason: 'Há ordem já faturada na seleção.' }
  if (selected.some((r) => r.amount == null)) return { ok: false, reason: 'Há ordem sem valor cobrado na seleção.' }
  const client = [...clients][0]!
  if (client === NO_CLIENT_LABEL) return { ok: false, reason: 'Vincule a ordem a um cliente cadastrado antes de faturar.' }
  return { ok: true, client }
}
