import type { SupabaseClient } from '@supabase/supabase-js'

// Supabase falso, em memória, para testes que exercitam o fluxo real dos
// engines (conversation-engine, deal-handoff etc.) sem depender de um
// projeto Supabase de verdade. Cobre só os métodos de query builder
// usados hoje pelo produto — não é um mock genérico do supabase-js.

type Row = Record<string, unknown>
type Db = Record<string, Row[]>
/** Injeção mínima de erro pra testar caminhos de "o write falhou" (ex.: guarda contra invenção da Fase 7 — nunca tratar uma ação como concluída sem persistência bem-sucedida). Chave = tabela, valor = mensagem de erro a devolver na próxima escrita (insert/update/upsert) contra ela. */
type ErrorConfig = Record<string, { insert?: string; update?: string; upsert?: string }>

/** Comparação ordenável genérica (string/number) — datas ISO comparam lexicalmente igual a uma coluna date/timestamptz real. */
function compare(a: unknown, b: unknown): number {
  const av = a as string | number
  const bv = b as string | number
  if (av < bv) return -1
  if (av > bv) return 1
  return 0
}

/** Singularização ingênua (só cobre plurais em -s/-ies, os únicos usados nos nomes de tabela do produto). */
function singularize(table: string): string {
  if (table.endsWith('ies')) return `${table.slice(0, -3)}y`
  if (table.endsWith('s')) return table.slice(0, -1)
  return table
}

type Embed = { alias: string; table: string }

/** Extrai relações embutidas de um select do tipo '*, candidates(*)' ou '*, unit:units(name)'. */
function parseEmbeds(columns: string): Embed[] {
  const embeds: Embed[] = []
  for (const match of columns.matchAll(/(?:(\w+):)?(\w+)\([^)]*\)/g)) {
    const [, alias, table] = match
    if (table) embeds.push({ alias: alias ?? table, table })
  }
  return embeds
}

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string } | null; count?: number }> {
  private filters: [string, unknown][] = []
  /** String bruta de .or('col.eq.x,col.is.null') — só suporta os operadores eq/is, os únicos usados hoje pelo produto. */
  private orFilter: string | null = null
  private orderBy: { key: string; ascending: boolean }[] = []
  private limitN: number | null = null
  private mode: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  private payload: Row | Row[] | null = null
  private singleMode: 'none' | 'maybeSingle' | 'single' = 'none'
  private onConflictKeys: string[] = []
  private embeds: Embed[] = []

  constructor(
    private table: string,
    private db: Db,
    private errors: ErrorConfig = {},
  ) {
    this.db[table] = this.db[table] ?? []
  }

  // Suporta o padrão de relação embutida usado pelo produto:
  // '*, candidates(*)' ou '*, unit:units(name)' — casa pelo id da tabela
  // relacionada com a coluna <singular(table)>_id da linha atual (mesma
  // convenção de FK usada em todo o schema).
  select(columns?: string) {
    if (typeof columns === 'string') this.embeds = parseEmbeds(columns)
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
  overlaps(key: string, values: unknown[]) {
    this.filters.push([key, { __overlaps: values } as unknown])
    return this
  }
  or(filterString: string) {
    this.orFilter = filterString
    return this
  }
  lt(key: string, value: unknown) {
    this.filters.push([key, { __lt: value } as unknown])
    return this
  }
  lte(key: string, value: unknown) {
    this.filters.push([key, { __lte: value } as unknown])
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
  upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
    this.mode = 'upsert'
    this.payload = payload
    this.onConflictKeys = opts?.onConflict?.split(',') ?? []
    return this
  }

  private matches(row: Row): boolean {
    const andOk = this.filters.every(([key, value]) => {
      if (value && typeof value === 'object' && '__overlaps' in (value as Record<string, unknown>)) {
        const target = (value as { __overlaps: unknown[] }).__overlaps
        const cell = row[key]
        return Array.isArray(cell) && cell.some((v) => target.includes(v))
      }
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
      if (value && typeof value === 'object' && '__lte' in (value as Record<string, unknown>)) {
        const target = (value as { __lte: unknown }).__lte
        const cell = row[key]
        return cell !== null && cell !== undefined && compare(cell, target) <= 0
      }
      return row[key] === value
    })
    if (!andOk) return false
    if (!this.orFilter) return true
    return this.orFilter.split(',').some((clause) => this.matchesOrClause(row, clause))
  }

  // Só cobre column.eq.value, column.is.null e column.not.is.null — os
  // únicos operadores que o produto usa em .or() hoje (ver
  // fetchActiveAttachments em lib/attachments.ts e a busca de leads
  // prontos para contato em lib/prospecting/engine.ts).
  private matchesOrClause(row: Row, clause: string): boolean {
    const parts = clause.split('.')
    const key = parts[0]
    if (!key) return false
    if (parts.length === 4 && parts[1] === 'not' && parts[2] === 'is' && parts[3] === 'null') {
      return row[key] !== null && row[key] !== undefined
    }
    const [, op, rawValue] = parts
    if (op === 'is') return rawValue === 'null' ? row[key] === null || row[key] === undefined : false
    if (op === 'eq') return String(row[key]) === rawValue
    return false
  }

  private resolve(): { data: unknown; error: { message: string } | null; count?: number } {
    const table = this.db[this.table]!

    if (this.mode !== 'select') {
      const forcedMessage = this.errors[this.table]?.[this.mode]
      if (forcedMessage) return { data: null, error: { message: forcedMessage } }
    }

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

    if (this.mode === 'upsert') {
      const arr = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
      const result: Row[] = []
      for (const p of arr) {
        const existing =
          this.onConflictKeys.length > 0
            ? table.find((row) => this.onConflictKeys.every((key) => row[key] === p[key]))
            : undefined
        if (existing) {
          Object.assign(existing, p, { updated_at: new Date().toISOString() })
          result.push(existing)
        } else {
          const inserted = {
            id: `${this.table}-${table.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...p,
          }
          table.push(inserted)
          result.push(inserted)
        }
      }
      const data = this.singleMode !== 'none' ? (result[0] ?? null) : result
      return { data, error: null }
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
    if (this.embeds.length > 0) {
      rows = rows.map((row) => {
        const embedded: Row = { ...row }
        for (const { alias, table } of this.embeds) {
          const fkKey = `${singularize(table)}_id`
          const related = (this.db[table] ?? []).find((r) => r.id === row[fkKey]) ?? null
          embedded[alias] = related
        }
        return embedded
      })
    }
    if (this.singleMode === 'maybeSingle' || this.singleMode === 'single') {
      return { data: rows[0] ?? null, error: null, count: rows.length }
    }
    return { data: rows, error: null, count: rows.length }
  }

  then<TResult1 = { data: unknown; error: { message: string } | null; count?: number }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: { message: string } | null; count?: number }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected)
  }
}

/**
 * `errors` força a próxima escrita (insert/update/upsert) contra uma
 * tabela a devolver `{data: null, error: {message}}` em vez de gravar —
 * pra testar o caminho "o write falhou" (ex.: guarda contra invenção da
 * Fase 7). É lido a cada chamada, então mutar o objeto retornado entre
 * duas chamadas na mesma seed muda o comportamento da próxima.
 */
export function createFakeSupabase(
  seed: Db = {},
  errors: ErrorConfig = {},
): { supabase: SupabaseClient; db: Db; errors: ErrorConfig } {
  const db: Db = seed
  const supabase = {
    from(table: string) {
      return new FakeQuery(table, db, errors)
    },
  } as unknown as SupabaseClient
  return { supabase, db, errors }
}
