// Achado real (2026-09-01, Vinicius): editou a descrição de um serviço
// avulso ("Compra de Material") DEPOIS que ele já tinha sido consolidado
// numa fatura — o PDF (e o e-mail/WhatsApp da fatura) continuaram
// mostrando o texto antigo. Causa raiz: consolidated_items é um
// SNAPSHOT congelado no momento da consolidação (ver
// generate_service_records_invoice/consolidate_invoices, migrations
// 047/045) — corrigir o lançamento avulso depois não propaga pra faturas
// que já o incluíram. Não era bug de cache do navegador (isso já tinha
// sido corrigido antes) — os dados em si é que estavam desatualizados.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConsolidatedInvoiceItem, Invoice } from '@/lib/types'

/**
 * Antes de renderizar o PDF/e-mail/WhatsApp de uma fatura consolidada,
 * busca a descrição ATUAL de cada serviço avulso incluído e sobrescreve
 * só esse campo no snapshot — nunca o valor cobrado nem a data, pra não
 * mexer em número já fechado/enviado/pago. Só sobrescreve quando o
 * lançamento ainda aponta pra ESTA fatura (service_records.invoice_id =
 * invoice.id); se foi reatribuído a outra fatura ou excluído, mantém o
 * texto original do snapshot em vez de arriscar mostrar dado de outro
 * lugar.
 */
export async function withFreshConsolidatedDescriptions<T extends Pick<Invoice, 'id' | 'consolidated_items'>>(
  supabase: SupabaseClient,
  invoice: T,
): Promise<T> {
  const items = invoice.consolidated_items
  if (!items || items.length === 0) return invoice

  // "invoice_id" dentro de cada item é, na verdade, o id do
  // service_record de origem (nome herdado da função SQL que monta o
  // snapshot — ver migration 047) — não confundir com o id da fatura.
  const serviceRecordIds = items.map((item) => item.invoice_id)
  const { data } = await supabase
    .from('service_records')
    .select('id, description')
    .in('id', serviceRecordIds)
    .eq('invoice_id', invoice.id)

  const liveDescriptions = new Map<string, string>((data ?? []).map((row) => [row.id as string, row.description as string]))
  if (liveDescriptions.size === 0) return invoice

  const refreshed: ConsolidatedInvoiceItem[] = items.map((item) =>
    liveDescriptions.has(item.invoice_id) ? { ...item, description: liveDescriptions.get(item.invoice_id)! } : item,
  )
  return { ...invoice, consolidated_items: refreshed }
}
