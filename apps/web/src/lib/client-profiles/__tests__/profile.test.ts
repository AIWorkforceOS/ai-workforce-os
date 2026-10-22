import { describe, expect, it } from 'vitest'
import { contractorFromProfile, DEFAULT_CONTRACTOR, normalizeClientName, pickContractor, sameClientName, type ClientProfile } from '../profile'
import { loadContractorBrand } from '../load'

const profile = (over: Partial<ClientProfile> = {}): ClientProfile => ({ id: 'p1', org_id: 'o1', name: 'Acme Facility Group', logo_url: null, address_line1: '500 Main Street', address_line2: 'Austin, TX 78701', phone: '555-0100', email: 'ops@acme.com', website: null, notes: null, is_active: true, ...over })

describe('perfil do cliente → cabeçalho da ordem', () => {
  it('monta o bloco do cliente (nome, endereço, telefone com prefixo, e-mail) e ignora campos vazios', () => {
    const c = contractorFromProfile(profile({ website: '  ', address_line2: null }))
    expect(c.lines).toEqual(['Acme Facility Group', '500 Main Street', 'Phone # 555-0100', 'ops@acme.com'])
    expect(c.initials).toBe('AFG')
    expect(c.logoUrl).toBeNull()
    expect(c.useLocal360Logo).toBe(false)
  })
  it('não duplica o prefixo "Phone" e só aceita logo https', () => {
    expect(contractorFromProfile(profile({ phone: 'Phone # 786-281-3413' })).lines).toContain('Phone # 786-281-3413')
    expect(contractorFromProfile(profile({ logo_url: 'http://inseguro/logo.png' })).logoUrl).toBeNull()
    expect(contractorFromProfile(profile({ logo_url: 'https://x/logo.png' })).logoUrl).toBe('https://x/logo.png')
  })
  it('a 360 cadastrada sem logo própria continua usando o arquivo de logo que já vem no sistema', () => {
    expect(contractorFromProfile(profile({ name: '360 Service Provider' })).useLocal360Logo).toBe(true)
    expect(contractorFromProfile(profile({ name: '360 Service Provider', logo_url: 'https://x/l.png' })).useLocal360Logo).toBe(false)
  })
  it('nome do cliente: comparação sem diferenciar caixa nem espaços repetidos', () => {
    expect(normalizeClientName('  Acme   Facility  ')).toBe('Acme Facility')
    expect(sameClientName('ACME facility', ' acme  Facility ')).toBe(true)
    expect(sameClientName('', '')).toBe(false)
  })
  it('escolhe o perfil do cliente da ordem; sem cliente ou sem perfil cai no padrão (360)', () => {
    const list = [profile(), profile({ id: 'p2', name: 'Beta Corp' })]
    expect(pickContractor(list, 'beta corp').lines[0]).toBe('Beta Corp')
    expect(pickContractor(list, 'Outro')).toBe(DEFAULT_CONTRACTOR)
    expect(pickContractor(list, null)).toBe(DEFAULT_CONTRACTOR)
    expect(pickContractor([], 'Acme Facility Group')).toBe(DEFAULT_CONTRACTOR)
  })
})

describe('carregamento tolerante a falha', () => {
  const client = (result: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ limit: async () => result }) }) }) }) as never
  it('busca os perfis da empresa e devolve o do cliente da ordem', async () => {
    const out = await loadContractorBrand(client({ data: [profile()], error: null }), 'o1', 'Acme Facility Group')
    expect(out.lines[0]).toBe('Acme Facility Group')
  })
  it('qualquer problema (erro, tabela inexistente, exceção, sem cliente/empresa) vira o padrão — nunca derruba o PDF', async () => {
    expect(await loadContractorBrand(client({ data: null, error: { message: 'relation does not exist' } }), 'o1', 'Acme')).toBe(DEFAULT_CONTRACTOR)
    expect(await loadContractorBrand(client(undefined), 'o1', 'Acme')).toBe(DEFAULT_CONTRACTOR)
    expect(await loadContractorBrand({ from: () => { throw new Error('boom') } } as never, 'o1', 'Acme')).toBe(DEFAULT_CONTRACTOR)
    expect(await loadContractorBrand(client({ data: [profile()], error: null }), null, 'Acme Facility Group')).toBe(DEFAULT_CONTRACTOR)
    expect(await loadContractorBrand(client({ data: [profile()], error: null }), 'o1', null)).toBe(DEFAULT_CONTRACTOR)
  })
})

import { clientBrandFor, hasBrandLogo, mawiBrandFromUnit, resolveSignOffBrand, DEFAULT_CONTRACTOR as DEFAULT_360 } from '../profile'

describe('marca do Sign Off por quem vê', () => {
  const mawi = mawiBrandFromUnit({ name: 'Mawi Pro — Principal', billing_company_name: 'Mawi Pro Service', billing_address: '4315 E Thunderbird Rd', billing_phone: '9544102114', billing_email: 'info@mawiproservice.com' }, 'https://cdn/mawi.png')
  const withLogo = { id: '1', org_id: 'o', name: 'ACME', logo_url: 'https://cdn/acme.png', address_line1: '1 Main', address_line2: null, phone: null, email: null, website: null, notes: null, is_active: true }
  const noLogo = { ...withLogo, logo_url: null }

  it('marca da Mawi sai dos dados de cobrança da unidade, com telefone formatado', () => {
    expect(mawi.lines).toEqual(['Mawi Pro Service', '4315 E Thunderbird Rd', 'Phone # (954) 410-2114', 'info@mawiproservice.com'])
    expect(mawi.logoUrl).toBe('https://cdn/mawi.png')
    expect(mawi.useLocal360Logo).toBe(false)
  })
  it('técnico: sempre a Mawi, mesmo que o cliente tenha logo', () => {
    expect(resolveSignOffBrand('technician', clientBrandFor([withLogo], 'ACME'), mawi)).toBe(mawi)
    expect(resolveSignOffBrand('technician', DEFAULT_360, mawi)).toBe(mawi)
  })
  it('escritório e cliente: marca do cliente só se ele tem logo; senão a Mawi', () => {
    for (const v of ['office', 'client'] as const) {
      expect(resolveSignOffBrand(v, clientBrandFor([withLogo], 'ACME'), mawi).lines[0]).toBe('ACME')
      expect(resolveSignOffBrand(v, clientBrandFor([noLogo], 'ACME'), mawi)).toBe(mawi)
      expect(resolveSignOffBrand(v, clientBrandFor([], 'Desconhecido'), mawi)).toBe(mawi)
      expect(resolveSignOffBrand(v, clientBrandFor([withLogo], null), mawi)).toBe(mawi)
    }
  })
  it('a 360 mantém o arquivo de logo que já vem no sistema, mesmo sem cadastro', () => {
    expect(clientBrandFor([], '360 Service Provider')).toBe(DEFAULT_360)
    expect(hasBrandLogo(DEFAULT_360)).toBe(true)
    expect(resolveSignOffBrand('office', clientBrandFor([], '360 service provider'), mawi)).toBe(DEFAULT_360)
  })
  it('falha de leitura da unidade vira marca neutra, nunca a de um cliente', () => {
    const neutral = mawiBrandFromUnit({}, null)
    expect(neutral.lines).toEqual(['Service Provider'])
    expect(neutral.logoUrl).toBeNull()
  })
})
