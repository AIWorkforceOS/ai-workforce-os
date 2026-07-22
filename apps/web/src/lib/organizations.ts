import type { SupabaseClient } from '@supabase/supabase-js'
import { isVerticalKey, type VerticalKey } from '@/lib/verticals/catalog'
import type { ManagementMode } from '@/lib/types'

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
 * Busca organizations.management_mode (migration 032) — como o cliente usa
 * o Alizo, escolhido na configuração guiada. Best-effort no mesmo espírito
 * de fetchOrganizationVerticalKey: org sem escolha, erro (ex.: migration 032
 * ainda não aplicada) ou org inexistente caem em 'digital_employees', o
 * comportamento atual — nunca lança. Use `raw: true` pra distinguir "não
 * escolheu ainda" (null) de uma escolha explícita (wizard de onboarding).
 */
export async function fetchOrganizationManagementMode(
  supabase: SupabaseClient,
  orgId: string | null | undefined,
): Promise<ManagementMode>
export async function fetchOrganizationManagementMode(
  supabase: SupabaseClient,
  orgId: string | null | undefined,
  options: { raw: true },
): Promise<ManagementMode | null>
export async function fetchOrganizationManagementMode(
  supabase: SupabaseClient,
  orgId: string | null | undefined,
  options?: { raw: true },
): Promise<ManagementMode | null> {
  const fallback = options?.raw ? null : 'digital_employees'
  if (!orgId) return fallback
  const { data } = await supabase.from('organizations').select('management_mode').eq('id', orgId).maybeSingle()
  const mode = (data as { management_mode?: string | null } | null)?.management_mode
  if (mode === 'full_management' || mode === 'digital_employees') return mode
  return fallback
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
