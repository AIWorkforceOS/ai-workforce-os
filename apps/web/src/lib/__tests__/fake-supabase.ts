import type { SupabaseClient } from '@supabase/supabase-js'

// Supabase falso, em memória, para testes que exercitam o fluxo real dos
// engines (conversation-engine, deal-handoff etc.) sem depender de um
// projeto Supabase de verdade. Cobre só os métodos de query builder
// usados hoje pelo produto — não é um mock genérico do supabase-js.

type Row = Record<string, unknown>
type Db = Record<string, Row[]>

class FakeQuery implements PromiseLike<{ data: unknown; error: null; count?: number }> {
  private filters: [string, unknown][] = []
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
  not() {
    return this
  }
  in(key: string, values: unknown[]) {
    const set = new Set(values)
    this.filters.push([key, { __in: set } as unknown])
    return this
  }
  gte() {
    return this
  }
  order() {
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
      return { data: matched, error: null }
    }

    let rows = table.filter((row) => this.matches(row))
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
