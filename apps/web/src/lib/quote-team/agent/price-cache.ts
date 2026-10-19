import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PriceCache, VerifiedOption } from './pricing'

const TTL_MS = 7 * 24 * 3600 * 1000
const hash = (key: string) => createHash('sha256').update(key).digest('hex')

/** Cache de pesquisa de preço (dado PÚBLICO de catálogo; nada de cliente/ordem). Só resultados VERIFICADOS entram; validade de 7 dias. */
export class SupabasePriceCache implements PriceCache {
  constructor(private readonly db: () => SupabaseClient | null) {}

  async get(key: string): Promise<VerifiedOption[] | null> {
    const db = this.db()
    if (!db) return null
    const { data } = await db.from('product_price_cache').select('result, expires_at').eq('supplier', 'multi').eq('query_hash', hash(key)).maybeSingle()
    const row = data as { result: VerifiedOption[]; expires_at: string } | null
    if (!row || new Date(row.expires_at) <= new Date()) return null
    return row.result
  }

  async put(key: string, options: VerifiedOption[]): Promise<void> {
    const db = this.db()
    if (!db) return
    const now = new Date()
    await db.from('product_price_cache').upsert({ supplier: 'multi', query_hash: hash(key), normalized_query: key.slice(0, 300), result: options, retrieved_at: now.toISOString(), expires_at: new Date(now.getTime() + TTL_MS).toISOString() }, { onConflict: 'supplier,query_hash' })
  }
}
