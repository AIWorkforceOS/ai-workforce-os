import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { provisionOrgFromSignup, type ProvisionInput } from '../provision'

function input(overrides: Partial<ProvisionInput> = {}): ProvisionInput {
  return {
    company: 'Padaria Estrela',
    name: 'Maria Silva',
    email: 'maria@padaria.com',
    phone: '+55 11 99999-0000',
    plan: 'starter',
    currency: 'BRL',
    amount: 497,
    paymentMethod: 'card',
    region: 'BR',
    termsVersion: '2026-08-19-draft1',
    privacyVersion: '2026-08-19-draft1',
    acceptIp: '1.2.3.4',
    ...overrides,
  }
}

describe('provisionOrgFromSignup', () => {
  it('cria org + unidade principal + usuário admin + aceite de termos + cobrança pendente', async () => {
    const { supabase, db } = createFakeSupabase({})

    const result = await provisionOrgFromSignup(supabase, input())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(db.organizations).toHaveLength(1)
    expect((db.organizations as Array<Record<string, unknown>>)[0]).toMatchObject({ name: 'Padaria Estrela', plan: 'starter' })
    expect(db.units).toHaveLength(1)
    expect(db.users).toHaveLength(1)
    expect((db.users as Array<Record<string, unknown>>)[0]).toMatchObject({ email: 'maria@padaria.com', role: 'admin' })
    expect(db.legal_acceptances).toHaveLength(1)
    expect(db.financial_records).toHaveLength(1)
    expect((db.financial_records as Array<Record<string, unknown>>)[0]).toMatchObject({ status: 'pending', amount: 497, currency: 'BRL' })
  })

  it('desfaz a org (rollback) se a criação da unidade falhar', async () => {
    const { supabase, db } = createFakeSupabase({}, { units: { insert: 'boom' } })

    const result = await provisionOrgFromSignup(supabase, input())

    expect(result.ok).toBe(false)
    expect(db.organizations ?? []).toHaveLength(0)
  })

  it('desfaz a org (rollback) se a criação do usuário falhar', async () => {
    const { supabase, db } = createFakeSupabase({}, { users: { insert: 'boom' } })

    const result = await provisionOrgFromSignup(supabase, input())

    expect(result.ok).toBe(false)
    expect(db.organizations ?? []).toHaveLength(0)
  })

  it('slugs únicos: empresa com mesmo nome de uma org já existente ganha sufixo -2', async () => {
    const { supabase, db } = createFakeSupabase({
      organizations: [{ id: 'org-0', name: 'Padaria Estrela', slug: 'padaria-estrela' }],
    })

    const result = await provisionOrgFromSignup(supabase, input())

    expect(result.ok).toBe(true)
    const orgs = db.organizations as Array<Record<string, unknown>>
    expect(orgs).toHaveLength(2)
    expect(orgs[1]!.slug).toBe('padaria-estrela-2')
  })
})
