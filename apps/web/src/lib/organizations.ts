import type { SupabaseClient } from '@supabase/supabase-js'
import { isVerticalKey, type VerticalKey } from '@/lib/verticals/catalog'

/**
 * Busca organizations.vertical_key (migration 025) pra resolver a
 * terminologia por segmento nas telas (ver lib/verticals/terminology.ts).
 * Best-effort: org sem vertical_key, erro ou org inexistente vira null,
 * que cai no termo genérico — nunca lança.
 */
export async function fetchOrganizationVerticalKey(
  supabase: SupabaseClient,
  orgId: string | null | undefined,
): Promise<VerticalKey | null> {
  if (!orgId) return null
  const { data } = await supabase.from('organizations').select('vertical_key').eq('id', orgId).maybeSingle()
  const key = (data as { vertical_key?: string | null } | null)?.vertical_key
  return isVerticalKey(key) ? key : null
}

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
