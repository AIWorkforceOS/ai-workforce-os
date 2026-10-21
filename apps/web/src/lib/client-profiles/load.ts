import type { SupabaseClient } from '@supabase/supabase-js'
import { CLIENT_PROFILE_COLUMNS, DEFAULT_CONTRACTOR, pickContractor, type ClientProfile, type ContractorBrand } from './profile'

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
