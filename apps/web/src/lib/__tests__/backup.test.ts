import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from './fake-supabase'
import { runDatabaseBackup, BACKUP_TABLES } from '../backup'

// runDatabaseBackup (2026-09-27, pedido do Vinicius): "todas informações,
// valores, WOs, valores lançados precisa esta sempre salvo nunca pode se
// perder" — a conta do Supabase é plano Free, sem backup automático nenhum
// (só existe a partir do Pro). Este backup lógico exporta cada tabela de
// negócio pra um JSON no bucket privado `backups`, um por tabela, um por
// dia. Roda todo dia via /api/cron/db-backup.

function attachFakeStorage(supabase: ReturnType<typeof createFakeSupabase>['supabase']) {
  const uploads: { path: string; body: string }[] = []
  const failPaths = new Set<string>()
  ;(supabase as unknown as { storage: unknown }).storage = {
    from: () => ({
      upload: vi.fn(async (path: string, body: string) => {
        if (failPaths.has(path)) return { error: { message: 'falha simulada no upload' } }
        uploads.push({ path, body })
        return { error: null }
      }),
    }),
  }
  return { uploads, failPaths }
}

describe('runDatabaseBackup', () => {
  it('exporta cada tabela de BACKUP_TABLES como um JSON separado, num caminho com a data de hoje', async () => {
    const { supabase } = createFakeSupabase({
      organizations: [{ id: 'org-1', name: 'Mawi Pro' }],
      units: [{ id: 'unit-1', org_id: 'org-1', name: 'Mawi Pro — Principal' }],
      appointments: [{ id: 'appt-1', unit_id: 'unit-1' }],
    })
    const { uploads } = attachFakeStorage(supabase)

    const result = await runDatabaseBackup(supabase)

    expect(result.tables).toHaveLength(BACKUP_TABLES.length)
    expect(result.tables.every((t) => t.error === null)).toBe(true)

    const today = new Date().toISOString().slice(0, 10)
    const orgUpload = uploads.find((u) => u.path === `${today}/organizations.json`)
    expect(orgUpload).toBeDefined()
    expect(JSON.parse(orgUpload!.body)).toEqual([{ id: 'org-1', name: 'Mawi Pro' }])

    const appointmentsResult = result.tables.find((t) => t.table === 'appointments')
    expect(appointmentsResult).toMatchObject({ rows: 1, error: null })

    const emptyTableResult = result.tables.find((t) => t.table === 'financial_records')
    expect(emptyTableResult).toMatchObject({ rows: 0, error: null })
  })

  it('pagina tabelas grandes (mais de 1000 linhas) em várias páginas, sem perder nenhuma', async () => {
    const manyAppointments = Array.from({ length: 1500 }, (_, i) => ({ id: `appt-${i}`, unit_id: 'unit-1' }))
    const { supabase } = createFakeSupabase({ appointments: manyAppointments })
    attachFakeStorage(supabase)

    const result = await runDatabaseBackup(supabase)

    const appointmentsResult = result.tables.find((t) => t.table === 'appointments')
    expect(appointmentsResult).toMatchObject({ rows: 1500, error: null })
  })

  it('falha numa tabela não impede o backup das outras — cada tabela é isolada', async () => {
    const { supabase } = createFakeSupabase({ organizations: [{ id: 'org-1' }] })
    const { failPaths } = attachFakeStorage(supabase)
    const today = new Date().toISOString().slice(0, 10)
    failPaths.add(`${today}/organizations.json`)

    const result = await runDatabaseBackup(supabase)

    const orgResult = result.tables.find((t) => t.table === 'organizations')
    expect(orgResult?.error).toContain('falha simulada')
    const unitsResult = result.tables.find((t) => t.table === 'units')
    expect(unitsResult).toMatchObject({ rows: 0, error: null })
  })
})
