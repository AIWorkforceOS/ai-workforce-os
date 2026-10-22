import type { SupabaseClient } from '@supabase/supabase-js'
import { CLIENT_PROFILE_COLUMNS, DEFAULT_CONTRACTOR, clientBrandFor, mawiBrandFromUnit, pickContractor, resolveSignOffBrand, type ClientProfile, type ContractorBrand, type SignOffViewer } from './profile'
import { readOrgLogoUrl } from '@/lib/branding/org-logo'

/**
 * Dados do cliente da ordem para o PDF. NUNCA derruba a geração do documento: qualquer falha (tabela ainda inexistente, sem permissão, rede)
 * devolve o padrão (360), exatamente como o PDF sempre saiu.
 */
export async function loadContractorBrand(supabase: SupabaseClient, orgId: string | null | undefined, clientCompany: string | null | undefined): Promise<ContractorBrand> {
  if (!orgId || !clientCompany) return DEFAULT_CONTRACTOR
  try {
    const result = (await supabase.from('client_company_profiles').select(CLIENT_PROFILE_COLUMNS).eq('org_id', orgId).limit(200)) as { data?: unknown; error?: unknown } | undefined
    if (!result || result.error || !Array.isArray(result.data)) return DEFAULT_CONTRACTOR
    return pickContractor(result.data as ClientProfile[], clientCompany)
  } catch {
    return DEFAULT_CONTRACTOR
  }
}

/**
 * Marca da Mawi (quem presta o serviço) para o Sign Off. Lê com a chave de serviço no servidor: o técnico não precisa — nem pode — ler cadastros
 * de cliente. Falha de leitura nunca cai na marca de um cliente: vira uma marca neutra só com o nome da unidade.
 */
export async function loadMawiBrand(service: SupabaseClient | null, unitId: string | null | undefined, orgId: string | null | undefined): Promise<ContractorBrand> {
  const neutral = mawiBrandFromUnit({}, null)
  if (!service || !unitId) return neutral
  try {
    const { data, error } = await service.from('units').select('name, logo_url, billing_company_name, billing_address, billing_phone, billing_email').eq('id', unitId).maybeSingle()
    if (error || !data) return neutral
    const unit = data as { name: string | null; logo_url: string | null; billing_company_name: string | null; billing_address: string | null; billing_phone: string | null; billing_email: string | null }
    const orgLogo = await readOrgLogoUrl(orgId ?? null)
    return mawiBrandFromUnit(unit, orgLogo ?? unit.logo_url)
  } catch {
    return neutral
  }
}

/**
 * Marca final do Sign Off para quem está pedindo (ver resolveSignOffBrand). Para o técnico NÃO consulta nenhum cadastro de cliente.
 * `clientReader` = cliente de banco que pode ler os cadastros de cliente (o do próprio usuário para o escritório; o de serviço para o portal do cliente).
 */
export async function loadSignOffBrand(args: { viewer: SignOffViewer; service: SupabaseClient | null; clientReader: SupabaseClient | null; unitId: string | null | undefined; orgId: string | null | undefined; clientCompany: string | null | undefined }): Promise<ContractorBrand> {
  const mawi = await loadMawiBrand(args.service, args.unitId, args.orgId)
  if (args.viewer === 'technician' || !args.clientReader || !args.orgId) return mawi
  try {
    const result = (await args.clientReader.from('client_company_profiles').select(CLIENT_PROFILE_COLUMNS).eq('org_id', args.orgId).limit(200)) as { data?: unknown; error?: unknown } | undefined
    const profiles = !result || result.error || !Array.isArray(result.data) ? [] : (result.data as ClientProfile[])
    return resolveSignOffBrand(args.viewer, clientBrandFor(profiles, args.clientCompany), mawi)
  } catch {
    return mawi
  }
}
