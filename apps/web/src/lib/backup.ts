import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Tabelas de negócio que precisam sobreviver a qualquer bug ou exclusão
 * acidental — pedido do Vinicius (2026-09-27): "todas informações,
 * valores, WOs, valores lançados precisa esta sempre salvo nunca pode
 * se perder". A conta do Supabase está no plano Free, que não oferece
 * NENHUM backup automático (isso começa no plano Pro) — este é um
 * backup lógico (JSON no Storage) que dá pra construir sem mudar de
 * plano: não substitui um backup de banco de verdade, mas é a rede de
 * segurança contra o cenário mais provável (um bug de app apagando ou
 * sobrescrevendo dados — como os dois achados de hoje, WO revisado e
 * RLS de funcionário). Não inclui tabelas de credencial (facilit_credentials,
 * evolution_api_key em units etc.) de propósito — nunca duplica segredo
 * pra um lugar com menos proteção que o banco original.
 */
export const BACKUP_TABLES = [
  'organizations',
  'units',
  'employees',
  'customers',
  'appointments',
  'service_records',
  'service_record_payments',
  'invoices',
  'financial_records',
  'facilit_work_orders',
] as const

const PAGE_SIZE = 1000

async function fetchAllRows(supabase: SupabaseClient, table: string): Promise<unknown[]> {
  const rows: unknown[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as unknown[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}

export type BackupTableResult = { table: string; rows: number; error: string | null }
export type BackupResult = { date: string; tables: BackupTableResult[] }

/**
 * Exporta cada tabela de BACKUP_TABLES pra um arquivo JSON no bucket
 * privado `backups` (storage.buckets, migration 087 — sem policy pra
 * anon/authenticated de propósito, só o service role acessa), um
 * arquivo por tabela dentro de uma pasta com a data do dia (sobrescreve
 * se já rodou hoje, nunca duplica). Precisa do service role: é o único
 * jeito de ler todas as orgs/unidades de uma vez (RLS normal restringe
 * por org). Falha numa tabela nunca impede as outras — cada uma é
 * isolada, e o resultado final lista o que funcionou e o que não, pra
 * o cron poder alertar sem esconder um problema parcial.
 */
export async function runDatabaseBackup(supabase: SupabaseClient): Promise<BackupResult> {
  const date = new Date().toISOString().slice(0, 10)
  const tables: BackupTableResult[] = []

  for (const table of BACKUP_TABLES) {
    try {
      const rows = await fetchAllRows(supabase, table)
      const { error: uploadError } = await supabase.storage
        .from('backups')
        .upload(`${date}/${table}.json`, JSON.stringify(rows), { contentType: 'application/json', upsert: true })
      if (uploadError) throw new Error(uploadError.message)
      tables.push({ table, rows: rows.length, error: null })
    } catch (error) {
      tables.push({ table, rows: 0, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return { date, tables }
}
