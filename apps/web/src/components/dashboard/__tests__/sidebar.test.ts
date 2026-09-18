import { describe, expect, it } from 'vitest'
import { getVisibleNavGroups } from '@/components/dashboard/nav-groups'

// Cobre a arquitetura de navegação da Fase 2 (docs/ux-audit-fase1-2026-08-19.md
// §2): grupos por objetivo do usuário, sem duplicar itens entre modos, com
// Conteúdo/SEO deixando de ser rotas órfãs (não apareciam em nenhum menu).

function allHrefs(groups: ReturnType<typeof getVisibleNavGroups>): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.href))
}

describe('getVisibleNavGroups', () => {
  it('admin comum (management_mode=digital_employees) não vê Clientes nem Agenda, mas vê Operação', () => {
    const groups = getVisibleNavGroups({ role: 'admin', managementMode: 'digital_employees' })
    const hrefs = allHrefs(groups)
    expect(hrefs).not.toContain('/dashboard/receptionist/customers')
    expect(hrefs).not.toContain('/dashboard/agenda')
    expect(hrefs).toContain('/dashboard/operacao')
  })

  it('admin em full_management vê Clientes e Agenda liberados', () => {
    const groups = getVisibleNavGroups({ role: 'admin', managementMode: 'full_management' })
    const hrefs = allHrefs(groups)
    expect(hrefs).toContain('/dashboard/receptionist/customers')
    expect(hrefs).toContain('/dashboard/agenda')
  })

  it('super_admin nunca vê Clientes/Agenda de full_management, mesmo se o campo vier setado', () => {
    const groups = getVisibleNavGroups({ role: 'super_admin', managementMode: 'full_management' })
    const hrefs = allHrefs(groups)
    expect(hrefs).not.toContain('/dashboard/receptionist/customers')
    expect(hrefs).not.toContain('/dashboard/agenda')
  })

  it('itens superOnly só aparecem para super_admin', () => {
    const admin = allHrefs(getVisibleNavGroups({ role: 'admin' }))
    const superAdmin = allHrefs(getVisibleNavGroups({ role: 'super_admin' }))
    for (const href of ['/dashboard/organizations', '/dashboard/financial', '/dashboard/sales', '/dashboard/sales/payments', '/dashboard/sales/financeiro']) {
      expect(admin).not.toContain(href)
      expect(superAdmin).toContain(href)
    }
  })

  it('dono de unidade (unitId setado) recebe hrefs escopados à própria unidade', () => {
    const groups = getVisibleNavGroups({ role: 'admin', managementMode: 'full_management', unitId: 'unit-123', facilitEnabled: true })
    const flatItems = groups.flatMap((g) => g.items)

    const units = flatItems.find((i) => i.href === '/dashboard/units/unit-123')
    expect(units).toBeDefined()
    expect(units?.label.pt).toBe('Minha unidade')

    expect(flatItems.some((i) => i.href === '/dashboard/units/unit-123/operacao')).toBe(true)
    expect(flatItems.some((i) => i.href === '/dashboard/units/unit-123/agenda/calendario')).toBe(true)
    expect(flatItems.some((i) => i.href === '/dashboard/units/unit-123/facilit')).toBe(true)

    // hrefs genéricos (hub multi-unidade) não devem sobrar quando há unitId
    expect(flatItems.some((i) => i.href === '/dashboard/units')).toBe(false)
    expect(flatItems.some((i) => i.href === '/dashboard/operacao')).toBe(false)
    expect(flatItems.some((i) => i.href === '/dashboard/agenda')).toBe(false)
    expect(flatItems.some((i) => i.href === '/dashboard/facilit')).toBe(false)
  })

  it('Facil-IT (360) é específico da Mawi Pro — some do menu de qualquer outra organização por padrão', () => {
    const hrefs = allHrefs(getVisibleNavGroups({ role: 'admin' }))
    expect(hrefs).not.toContain('/dashboard/facilit')
  })

  it('Facil-IT (360) aparece só quando organizations.facilit_integration_enabled = true', () => {
    const hrefs = allHrefs(getVisibleNavGroups({ role: 'admin', facilitEnabled: true }))
    expect(hrefs).toContain('/dashboard/facilit')
  })

  it('Facil-IT (360) some mesmo com unitId + facilitEnabled=false (dono de unidade de outra org)', () => {
    const hrefs = allHrefs(getVisibleNavGroups({ role: 'admin', unitId: 'unit-123', facilitEnabled: false }))
    expect(hrefs).not.toContain('/dashboard/units/unit-123/facilit')
  })

  it('Conteúdo e SEO aparecem no menu de Marketing (deixam de ser rotas órfãs)', () => {
    const hrefs = allHrefs(getVisibleNavGroups({ role: 'admin' }))
    expect(hrefs).toContain('/dashboard/content')
    expect(hrefs).toContain('/dashboard/seo')
  })

  // Redesign do menu (2026-09-18, pedido do Vinicius): navegação por
  // funcionário digital em vez de por objetivo do usuário — os 6
  // funcionários levam direto pro "painel" (mesmo panelHref já usado em
  // employee-catalog.tsx), sem item de menu separado por ação
  // (configurar/treinar/testar/conexões ficam na barra de abas de cada
  // painel, ver EmployeeHubTabs).
  it('os 6 funcionários digitais aparecem no grupo "Funcionários", cada um levando pro próprio painel', () => {
    const groups = getVisibleNavGroups({ role: 'admin' })
    const funcionarios = groups.find((g) => g.label.pt === 'Funcionários')
    expect(funcionarios).toBeDefined()
    const hrefs = funcionarios!.items.map((i) => i.href)
    expect(hrefs).toEqual([
      '/dashboard/agents',
      '/dashboard/recruiter',
      '/dashboard/receptionist',
      '/dashboard/content',
      '/dashboard/traffic',
      '/dashboard/seo',
    ])
  })

  it('Início tem só Visão geral e Treinamento guiado — o resto desceu pros grupos finais', () => {
    const groups = getVisibleNavGroups({ role: 'admin' })
    const inicio = groups.find((g) => g.label.pt === 'Início')
    expect(inicio?.items.map((i) => i.href)).toEqual(['/dashboard', '/dashboard/onboarding'])
  })

  it('Financeiro é seu próprio grupo, apontando pra Operação', () => {
    const hrefs = allHrefs(getVisibleNavGroups({ role: 'admin' }))
    const financeiro = getVisibleNavGroups({ role: 'admin' }).find((g) => g.label.pt === 'Financeiro')
    expect(financeiro?.items.map((i) => i.href)).toEqual(['/dashboard/operacao'])
    expect(hrefs).toContain('/dashboard/operacao')
  })

  it('nenhum href da arquitetura antiga (por objetivo) sumiu — só mudou de grupo', () => {
    const hrefs = allHrefs(getVisibleNavGroups({ role: 'admin', managementMode: 'full_management' }))
    for (const href of [
      '/dashboard',
      '/dashboard/onboarding',
      '/dashboard/conversations',
      '/dashboard/crm',
      '/dashboard/leads',
      '/dashboard/receptionist/customers',
      '/dashboard/receptionist',
      '/dashboard/agents',
      '/dashboard/agenda',
      '/dashboard/operacao',
      '/dashboard/employees',
      '/dashboard/recruiter',
      '/dashboard/traffic',
      '/dashboard/content',
      '/dashboard/seo',
      '/dashboard/email-marketing',
      '/dashboard/equipe-digital',
      '/dashboard/results',
      '/dashboard/settings',
      '/dashboard/units',
      '/dashboard/messaging/connect',
    ]) {
      expect(hrefs).toContain(href)
    }
  })

  it('nenhum grupo visível fica vazio, e nenhum href aparece duplicado', () => {
    for (const role of ['admin', 'super_admin'] as const) {
      for (const managementMode of ['digital_employees', 'full_management'] as const) {
        const groups = getVisibleNavGroups({ role, managementMode })
        for (const group of groups) {
          expect(group.items.length).toBeGreaterThan(0)
        }
        const hrefs = allHrefs(groups)
        expect(new Set(hrefs).size).toBe(hrefs.length)
      }
    }
  })
})
