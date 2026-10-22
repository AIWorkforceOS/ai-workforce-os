import { describe, expect, it } from 'vitest'
import { assignableJobRole, canAccessModule, moduleForPath, parseJobRole, pathNeedsJobRoleCheck } from '../job-roles'

describe('moduleForPath', () => {
  it.each([
    ['/dashboard', 'home'],
    ['/dashboard/sem-acesso', 'home'],
    ['/dashboard/units/abc/agenda/calendario', 'agenda'],
    ['/dashboard/units/abc/relatorios', 'agenda'],
    ['/dashboard/units/abc/clientes/ACME', 'clientes'],
    ['/dashboard/units/abc/operacao', 'financeiro'],
    ['/dashboard/units/abc/faturamento', 'financeiro'],
    ['/dashboard/faturamento', 'financeiro'],
    ['/dashboard/operacao', 'financeiro'],
    ['/dashboard/receptionist/customers', 'clientes'],
    ['/dashboard/receptionist', 'agentes'],
    ['/dashboard/crm', 'crm'],
    ['/dashboard/leads/123', 'crm'],
    ['/dashboard/employees', 'equipe'],
    ['/dashboard/settings', 'config'],
    ['/dashboard/units/abc/settings', 'config'],
    ['/dashboard/units', 'config'],
    ['/dashboard/qualquer-coisa-nova', 'config'],
  ])('%s → %s', (path, mod) => expect(moduleForPath(path)).toBe(mod))
})

describe('canAccessModule', () => {
  it('sem função = tudo', () => {
    expect(canAccessModule(null, 'financeiro')).toBe(true)
    expect(canAccessModule(undefined, 'config')).toBe(true)
  })
  it('financeiro não vê vendas nem config; comercial/operacional não veem financeiro', () => {
    expect(canAccessModule('financeiro', 'financeiro')).toBe(true)
    expect(canAccessModule('financeiro', 'crm')).toBe(false)
    expect(canAccessModule('financeiro', 'config')).toBe(false)
    expect(canAccessModule('comercial', 'financeiro')).toBe(false)
    expect(canAccessModule('operacional', 'financeiro')).toBe(false)
    expect(canAccessModule('operacional', 'agenda')).toBe(true)
    expect(canAccessModule('comercial', 'crm')).toBe(true)
  })
  it('nenhuma função restrita acessa config (usuários, marca, unidades)', () => {
    for (const r of ['financeiro', 'comercial', 'operacional'] as const) expect(canAccessModule(r, 'config')).toBe(false)
  })
})

describe('helpers', () => {
  it('pathNeedsJobRoleCheck', () => {
    expect(pathNeedsJobRoleCheck('/dashboard')).toBe(false)
    expect(pathNeedsJobRoleCheck('/dashboard/units/x/agenda/calendario')).toBe(false)
    expect(pathNeedsJobRoleCheck('/dashboard/units/x/faturamento')).toBe(true)
  })
  it('parseJobRole e assignableJobRole', () => {
    expect(parseJobRole('financeiro')).toBe('financeiro')
    expect(parseJobRole('super_admin')).toBeNull()
    expect(assignableJobRole('admin')).toBeNull()
    expect(assignableJobRole(undefined)).toBeNull()
    expect(assignableJobRole('')).toBeNull()
    expect(assignableJobRole('comercial')).toBe('comercial')
    expect(assignableJobRole('root')).toBeUndefined()
  })
})
