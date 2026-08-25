import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { fetchOrgBillingStatus, isOrgBillingBlocked } from '../billing-gate'

describe('isOrgBillingBlocked', () => {
  it('bloqueia past_due e canceled', () => {
    expect(isOrgBillingBlocked('past_due')).toBe(true)
    expect(isOrgBillingBlocked('canceled')).toBe(true)
  })

  it('nunca bloqueia trialing, active, grace_period ou null/undefined', () => {
    expect(isOrgBillingBlocked('trialing')).toBe(false)
    expect(isOrgBillingBlocked('active')).toBe(false)
    expect(isOrgBillingBlocked('grace_period')).toBe(false)
    expect(isOrgBillingBlocked(null)).toBe(false)
    expect(isOrgBillingBlocked(undefined)).toBe(false)
  })
})

describe('fetchOrgBillingStatus', () => {
  it('devolve o billing_status real da organização', async () => {
    const { supabase } = createFakeSupabase({
      organizations: [{ id: 'org-1', billing_status: 'past_due' }],
    })
    expect(await fetchOrgBillingStatus(supabase, 'org-1')).toBe('past_due')
  })

  it('sem orgId, devolve null sem consultar o banco', async () => {
    const { supabase } = createFakeSupabase({})
    expect(await fetchOrgBillingStatus(supabase, null)).toBeNull()
    expect(await fetchOrgBillingStatus(supabase, undefined)).toBeNull()
  })

  it('org inexistente devolve null (best-effort, nunca lança)', async () => {
    const { supabase } = createFakeSupabase({ organizations: [] })
    expect(await fetchOrgBillingStatus(supabase, 'org-que-nao-existe')).toBeNull()
  })
})
