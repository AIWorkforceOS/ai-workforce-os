import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Busca a Ficha da Empresa compartilhada (organizations.business_profile,
 * migration 025) para compor os prompts dos 4 funcionários digitais junto
 * com a ficha específica de cada um (ver buildCombinedBusinessContext em
 * lib/interview/engine.ts). Best-effort: erro ou org sem ficha vira null,
 * nunca lança — os prompts já funcionam sem ela (comportamento de hoje).
 */
export async function fetchOrganizationBusinessProfile(
  supabase: SupabaseClient,
  orgId: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!orgId) return null
  const { data } = await supabase.from('organizations').select('business_profile').eq('id', orgId).maybeSingle()
  return (data as { business_profile?: Record<string, unknown> } | null)?.business_profile ?? null
}
