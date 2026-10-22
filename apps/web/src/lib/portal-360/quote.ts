/** Linhas de material da cotação (custom_fields.quote_items): o que o cliente vê item a item, com quantidade e preço. */
export type QuoteItem = { description: string; quantity: number; unitPrice: number }

const r2 = (n: number) => Math.round(n * 100) / 100

export function lineTotal(item: Pick<QuoteItem, 'quantity' | 'unitPrice'>): number {
  return r2(item.quantity * item.unitPrice)
}

export function itemsTotal(items: QuoteItem[]): number {
  return r2(items.reduce((sum, i) => sum + lineTotal(i), 0))
}

/** Lê as linhas com tolerância: o que não tem descrição ou número válido é descartado. */
export function parseQuoteItems(customFields: Record<string, unknown> | null | undefined): QuoteItem[] {
  const raw = customFields?.quote_items
  if (!Array.isArray(raw)) return []
  const out: QuoteItem[] = []
  for (const r of raw.slice(0, 100)) {
    const o = (r ?? {}) as Record<string, unknown>
    const description = typeof o.description === 'string' ? o.description.trim().slice(0, 200) : ''
    const quantity = Number(o.quantity)
    const unitPrice = Number(o.unitPrice)
    if (description && Number.isFinite(quantity) && quantity > 0 && quantity <= 100000 && Number.isFinite(unitPrice) && unitPrice >= 0 && unitPrice <= 10_000_000) out.push({ description, quantity, unitPrice: r2(unitPrice) })
  }
  return out
}

/** Valida as linhas digitadas pelo escritório antes de salvar (linhas totalmente vazias são ignoradas). */
export function validateQuoteItems(rows: { description: string; quantity: string; unitPrice: string }[]): { ok: true; items: QuoteItem[] } | { ok: false; error: string } {
  const items: QuoteItem[] = []
  for (const [i, row] of rows.entries()) {
    if (!row.description.trim() && !row.quantity.trim() && !row.unitPrice.trim()) continue
    const quantity = Number(row.quantity.replace(',', '.'))
    const unitPrice = Number(row.unitPrice.replace(/[$,\s]/g, ''))
    if (!row.description.trim()) return { ok: false, error: `Line ${i + 1}: write what the item is.` }
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: `Line ${i + 1}: quantity must be greater than zero.` }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return { ok: false, error: `Line ${i + 1}: price must be zero or more.` }
    items.push({ description: row.description.trim().slice(0, 200), quantity, unitPrice: r2(unitPrice) })
  }
  return { ok: true, items }
}

export type QuoteTotals = {
  /** soma das linhas, ou o valor de material informado quando não há linhas */
  materials: number
  hours: number | null
  hasItems: boolean
  /** quanto passa (positivo) ou sobra (negativo) do valor que o cliente já tinha aprovado; null se ele não informou */
  overApprovedAmount: number | null
  overApprovedHours: number | null
}

export function quoteTotals(input: { items: QuoteItem[]; materialValue: number | null; hoursNeeded: number | null; approvedAmount: number | null; approvedHours: number | null }): QuoteTotals {
  const hasItems = input.items.length > 0
  const materials = hasItems ? itemsTotal(input.items) : r2(input.materialValue ?? 0)
  return {
    materials,
    hours: input.hoursNeeded,
    hasItems,
    overApprovedAmount: input.approvedAmount != null ? r2(materials - input.approvedAmount) : null,
    overApprovedHours: input.approvedHours != null && input.hoursNeeded != null ? r2(input.hoursNeeded - input.approvedHours) : null,
  }
}
