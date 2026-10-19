import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('@/lib/app-user', () => ({ getAppUser: async () => null }))
import { isAgentAvailableForEmployee } from '../server'

/** Banco mínimo: cada tabela devolve uma linha fixa em select().eq().maybeSingle(). */
function stubDb(rows: Record<string, Record<string, unknown> | null>): SupabaseClient {
  return {
    from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rows[table] ?? null }) }) }) }),
  } as unknown as SupabaseClient
}

describe('disponibilidade do agente para o técnico', () => {
  const live = { quote_ai_team_mode: 'live' }
  it('autorizado + ativo + unidade live ⇒ disponível', async () => {
    expect(await isAgentAvailableForEmployee(stubDb({ employees: { quote_agent_enabled: true, is_active: true }, units: live }), 'e', 'u')).toBe(true)
  })
  it('funcionário DESATIVADO nunca tem acesso, mesmo marcado', async () => {
    expect(await isAgentAvailableForEmployee(stubDb({ employees: { quote_agent_enabled: true, is_active: false }, units: live }), 'e', 'u')).toBe(false)
  })
  it('não autorizado ⇒ indisponível; unidade off ⇒ indisponível', async () => {
    expect(await isAgentAvailableForEmployee(stubDb({ employees: { quote_agent_enabled: false, is_active: true }, units: live }), 'e', 'u')).toBe(false)
    expect(await isAgentAvailableForEmployee(stubDb({ employees: { quote_agent_enabled: true, is_active: true }, units: { quote_ai_team_mode: 'off' } }), 'e', 'u')).toBe(false)
  })
})
