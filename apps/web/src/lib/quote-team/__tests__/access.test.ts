import { describe, expect, it } from 'vitest'
import { resolveQuoteJobAccess, type QuoteAccessUser } from '../access'

const job = { org_id: 'o1', unit_id: 'u1', mode: 'live' as const }
const user = (over: Partial<QuoteAccessUser>): QuoteAccessUser => ({ role: 'employee', isSuperAdmin: false, orgId: 'o1', unitId: null, employeeId: 'e1', ...over })

describe('acesso ao job de cotação', () => {
  it('técnico responsável vê só em modo LIVE; em SHADOW ninguém além do admin', () => {
    expect(resolveQuoteJobAccess(user({}), job, 'e1')).toBe('technician')
    expect(resolveQuoteJobAccess(user({}), { ...job, mode: 'shadow' }, 'e1')).toBe('none')
  })
  it('outro técnico, cliente do Portal 360 e outra empresa: nenhum acesso', () => {
    expect(resolveQuoteJobAccess(user({ employeeId: 'e2' }), job, 'e1')).toBe('none')
    expect(resolveQuoteJobAccess(user({ role: 'client', employeeId: null }), job, 'e1')).toBe('none')
    expect(resolveQuoteJobAccess(user({ orgId: 'o2' }), job, 'e1')).toBe('none')
    expect(resolveQuoteJobAccess(user({ role: 'viewer', employeeId: null }), job, 'e1')).toBe('none')
  })
  it('admin da mesma empresa vê tudo (inclusive shadow); admin de outra empresa não; admin preso a outra unidade não', () => {
    const admin = user({ role: 'admin', employeeId: null })
    expect(resolveQuoteJobAccess(admin, { ...job, mode: 'shadow' }, 'e1')).toBe('admin')
    expect(resolveQuoteJobAccess({ ...admin, orgId: 'o2' }, job, 'e1')).toBe('none')
    expect(resolveQuoteJobAccess({ ...admin, unitId: 'u9' }, job, 'e1')).toBe('none')
    expect(resolveQuoteJobAccess({ ...admin, unitId: 'u1' }, job, 'e1')).toBe('admin')
  })
  it('super admin vê tudo', () => {
    expect(resolveQuoteJobAccess(user({ role: 'super_admin', isSuperAdmin: true, orgId: null, employeeId: null }), { ...job, mode: 'shadow' }, null)).toBe('admin')
  })
})
