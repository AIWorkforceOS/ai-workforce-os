import type { SupabaseClient } from '@supabase/supabase-js'

// Supabase falso, em memória, para testes que exercitam o fluxo real dos
// engines (conversation-engine, deal-handoff etc.) sem depender de um
// projeto Supabase de verdade. Cobre só os métodos de query builder
// usados hoje pelo produto — não é um mock genérico do supabase-js.

type Row = Record<string, unknown>
type Db = Record<string, Row[]>

/** Comparação ordenável genérica (string/number) — datas ISO comparam lexicalmente igual a uma coluna date/timestamptz real. */
function compare(a: unknown, b: unknown): number {
  const av = a as string | number
  const bv = b as string | number
  if (av < bv) return -1
  if (av > bv) return 1
  return 0
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null; count?: number }> {
  private filters: [string, unknown][] = []
  private orderBy: { key: string; ascending: boolean }[] = []
  private limitN: number | null = null
  private mode: 'select' | 'insert' | 'update' = 'select'
  private payload: Row | Row[] | null = null
  private singleMode: 'none' | 'maybeSingle' | 'single' = 'none'

  constructor(
    private table: string,
    private db: Db,
  ) {
    this.db[table] = this.db[table] ?? []
  }

  select() {
    return this
  }
  eq(key: string, value: unknown) {
    this.filters.push([key, value])
    return this
  }
  // Fake simplificado: só cobre o uso real do produto (busca de e-mail
  // exato, case-insensitive) — não interpreta padrões % de LIKE de verdade.
  ilike(key: string, value: unknown) {
    this.filters.push([
      key,
      { __ilike: typeof value === 'string' ? value.toLowerCase() : value } as unknown,
    ])
    return this
  }
  not() {
    return this
  }
  in(key: string, values: unknown[]) {
    const set = new Set(values)
    this.filters.push([key, { __in: set } as unknown])
    return this
  }
  gte(key: string, value: unknown) {
    this.filters.push([key, { __gte: value } as unknown])
    return this
  }
  lt(key: string, value: unknown) {
    this.filters.push([key, { __lt: value } as unknown])
    return this
  }
  // Suporta múltiplos .order() encadeados (desempate), igual ao Postgres:
  // o primeiro .order() é o critério principal, os seguintes só desempatam.
  order(key: string, opts?: { ascending?: boolean }) {
    this.orderBy.push({ key, ascending: opts?.ascending ?? true })
    return this
  }
  limit(n: number) {
    this.limitN = n
    return this
  }
  maybeSingle() {
    this.singleMode = 'maybeSingle'
    return this
  }
  single() {
    this.singleMode = 'single'
    return this
  }
  insert(payload: Row | Row[]) {
    this.mode = 'insert'
    this.payload = payload
    return this
  }
  update(payload: Row) {
    this.mode = 'update'
    this.payload = payload
    return this
  }

  private matches(row: Row): boolean {
    return this.filters.every(([key, value]) => {
      if (value && typeof value === 'object' && '__in' in (value as Record<string, unknown>)) {
        return (value as { __in: Set<unknown> }).__in.has(row[key])
      }
      if (value && typeof value === 'object' && '__ilike' in (value as Record<string, unknown>)) {
        const target = (value as { __ilike: unknown }).__ilike
        const cell = row[key]
        return typeof cell === 'string' && typeof target === 'string' && cell.toLowerCase() === target
      }
      // gte/lt: comparação lexical funciona pra datas ISO ('YYYY-MM-DD'),
      // igual ao que o Postgres faz numa coluna date/timestamptz de verdade.
      if (value && typeof value === 'object' && '__gte' in (value as Record<string, unknown>)) {
        const target = (value as { __gte: unknown }).__gte
        const cell = row[key]
        return cell !== null && cell !== undefined && compare(cell, target) >= 0
      }
      if (value && typeof value === 'object' && '__lt' in (value as Record<string, unknown>)) {
        const target = (value as { __lt: unknown }).__lt
        const cell = row[key]
        return cell !== null && cell !== undefined && compare(cell, target) < 0
      }
      return row[key] === value
    })
  }

  private resolve(): { data: unknown; error: null; count?: number } {
    const table = this.db[this.table]!

    if (this.mode === 'insert') {
      const arr = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
      const inserted = arr.map((p) => ({
        id: `${this.table}-${table.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...p,
      }))
      table.push(...inserted)
      const data = this.singleMode !== 'none' ? (inserted[0] ?? null) : inserted
      return { data, error: null }
    }

    if (this.mode === 'update') {
      const matched = table.filter((row) => this.matches(row))
      for (const row of matched) Object.assign(row, this.payload)
      const data = this.singleMode !== 'none' ? (matched[0] ?? null) : matched
      return { data, error: null, count: matched.length }
    }

    let rows = table.filter((row) => this.matches(row))
    if (this.orderBy.length > 0) {
      rows = [...rows].sort((a, b) => {
        for (const { key, ascending } of this.orderBy) {
          const av = a[key]
          const bv = b[key]
          if (av === bv) continue
          if (av === null || av === undefined) return ascending ? -1 : 1
          if (bv === null || bv === undefined) return ascending ? 1 : -1
          const cmp = compare(av, bv)
          return ascending ? cmp : -cmp
        }
        return 0
      })
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN)
    if (this.singleMode === 'maybeSingle' || this.singleMode === 'single') {
      return { data: rows[0] ?? null, error: null, count: rows.length }
    }
    return { data: rows, error: null, count: rows.length }
  }

  then<TResult1 = { data: unknown; error: null; count?: number }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null; count?: number }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected)
  }
}

export function createFakeSupabase(seed: Db = {}): { supabase: SupabaseClient; db: Db } {
  const db: Db = seed
  const supabase = {
    from(table: string) {
      return new FakeQuery(table, db)
    },
  } as unknown as SupabaseClient
  return { supabase, db }
}
