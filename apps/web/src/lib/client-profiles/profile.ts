import { DEFAULT_CLIENT_COMPANY_NAME } from '@/lib/portal-360/constants'

/**
 * Perfil do cliente (Facility) atendido: logo e dados que saem nas ORDENS DE SERVIÇO (PDF da WO) daquele cliente.
 * A chave é o nome já usado em customers.client_company ("360 Service Provider"…), sem diferenciar maiúsculas/minúsculas.
 * Sem perfil, o PDF sai como sempre saiu (360).
 */
export type ClientProfile = {
  id: string
  org_id: string
  name: string
  logo_url: string | null
  address_line1: string | null
  address_line2: string | null
  phone: string | null
  email: string | null
  website: string | null
  notes: string | null
  is_active: boolean
  /** prazo padrão de pagamento em dias (Net 15/30/45/60 ou livre); null = sem prazo padrão */
  payment_terms_days?: number | null
}

export const CLIENT_PROFILE_COLUMNS = 'id, org_id, name, logo_url, address_line1, address_line2, phone, email, website, notes, is_active'
/** Cadastro/edição do cliente: inclui o prazo de pagamento (migration 102). O PDF usa só CLIENT_PROFILE_COLUMNS, então não depende dela. */
export const CLIENT_PROFILE_EDIT_COLUMNS = `${CLIENT_PROFILE_COLUMNS}, payment_terms_days`

/** O que o PDF desenha no cabeçalho: bloco de texto da contratante + logo. */
export type ContractorBrand = {
  lines: string[]
  /** Iniciais para o selo no lugar da logo, quando o cliente não tem logo. */
  initials: string
  logoUrl: string | null
  /** Só a 360: usa o arquivo de logo que já vem no sistema (public/branding/360-logo.png). */
  useLocal360Logo: boolean
}

export const DEFAULT_CONTRACTOR: ContractorBrand = {
  lines: ['360 Service Provider', '11098 Biscayne Boulevard, Suite 305', 'Miami, FL 33161', 'Phone # 786-281-3413'],
  initials: '360',
  logoUrl: null,
  useLocal360Logo: true,
}

export function normalizeClientName(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ')
}

export function sameClientName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeClientName(a).toLowerCase()
  return x !== '' && x === normalizeClientName(b).toLowerCase()
}

function initialsOf(name: string): string {
  const letters = normalizeClientName(name)
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase()
  return letters || '•'
}

const clean = (v: string | null | undefined) => (v ?? '').trim()

export function contractorFromProfile(profile: Pick<ClientProfile, 'name' | 'logo_url' | 'address_line1' | 'address_line2' | 'phone' | 'email' | 'website'>): ContractorBrand {
  const phone = clean(profile.phone)
  const lines = [clean(profile.name), clean(profile.address_line1), clean(profile.address_line2), phone ? (/^phone/i.test(phone) ? phone : `Phone # ${phone}`) : '', clean(profile.email), clean(profile.website)].filter(Boolean)
  const logoUrl = clean(profile.logo_url).startsWith('https://') ? clean(profile.logo_url) : null
  return {
    lines,
    initials: initialsOf(profile.name),
    logoUrl,
    // a 360 cadastrada sem logo própria continua usando o arquivo que já vem no sistema
    useLocal360Logo: !logoUrl && sameClientName(profile.name, DEFAULT_CLIENT_COMPANY_NAME),
  }
}

/** Escolhe o perfil do cliente da ordem entre os da empresa; sem cliente ou sem perfil: o padrão (360). */
export function pickContractor(profiles: ClientProfile[], clientCompany: string | null | undefined): ContractorBrand {
  if (!clientCompany) return DEFAULT_CONTRACTOR
  const match = profiles.find((p) => sameClientName(p.name, clientCompany))
  return match ? contractorFromProfile(match) : DEFAULT_CONTRACTOR
}
