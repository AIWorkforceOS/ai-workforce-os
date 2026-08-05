import type { SupabaseClient } from '@supabase/supabase-js'
import { monthRange } from '@/lib/service-operations-month'

/**
 * Busca service_records/invoices da tela de Operação (migration 052),
 * filtrados pelo mês selecionado — ou sem filtro nenhum quando
 * isAllMonths (?month=all). Extraído de page.tsx pra ser testável
 * isoladamente sem precisar renderizar JSX (o transform de teste deste
 * projeto não lida com .tsx — ver apps/web/src/lib/__tests__/
 * operations-queries.test.ts, que reproduz o bug relatado em produção
 * de "selecionar julho não trazia os lançamentos de julho").
 */
export async function fetchOperationsData(
  supabase: SupabaseClient,
  unitId: string,
  selectedMonth: string,
  isAllMonths: boolean,
) {
  let recordsQuery = supabase
    .from('service_records')
    .select('*, employee:employees(id,name), customer:customers(id,name,email), service:services(id,name)')
    .eq('unit_id', unitId)
  let invoicesQuery = supabase.from('invoices').select('*, customer:customers(id,name,email,phone)').eq('unit_id', unitId)

  if (!isAllMonths) {
    const { start: monthStart, nextStart: monthNextStart } = monthRange(selectedMonth)
    recordsQuery = recordsQuery.gte('service_date', monthStart).lt('service_date', monthNextStart)
    invoicesQuery = invoicesQuery.gte('reference_month', monthStart).lt('reference_month', monthNextStart)
  }

  // "Todo o histórico" não tem o filtro de mês pra limitar o resultado, então
  // o teto de segurança é bem maior — não deve ser atingido em uso normal.
  const rowLimit = isAllMonths ? 5000 : 1000

  const [{ data: records }, { data: invoices }] = await Promise.all([
    recordsQuery.order('service_date', { ascending: false }).order('created_at', { ascending: false }).limit(rowLimit),
    invoicesQuery.order('created_at', { ascending: false }).limit(rowLimit),
  ])

  return { records: (records ?? []) as Record<string, unknown>[], invoices: (invoices ?? []) as Record<string, unknown>[] }
}

/**
 * Sugere o mês mais recente com histórico quando o mês atual (padrão da
 * tela) vem vazio — pra nunca parecer que dados antigos sumiram.
 */
export async function findMostRecentDataMonth(
  supabase: SupabaseClient,
  unitId: string,
): Promise<{ lastServiceDate: string | null; lastReferenceMonth: string | null }> {
  const [{ data: lastRecord }, { data: lastInvoice }] = await Promise.all([
    supabase
      .from('service_records')
      .select('service_date')
      .eq('unit_id', unitId)
      .order('service_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('invoices')
      .select('reference_month')
      .eq('unit_id', unitId)
      .order('reference_month', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  return {
    lastServiceDate: (lastRecord as { service_date?: string } | null)?.service_date ?? null,
    lastReferenceMonth: (lastInvoice as { reference_month?: string } | null)?.reference_month ?? null,
  }
}
