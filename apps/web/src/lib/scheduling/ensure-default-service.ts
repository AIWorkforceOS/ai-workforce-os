import type { SupabaseClient } from '@supabase/supabase-js'
import type { Service } from '@/lib/types'

/**
 * Sem nenhum serviço cadastrado, nenhuma tela de agenda deixa agendar —
 * mesmo com cliente e colaborador prontos (canBook exige services.length
 * > 0). Isso era o bloqueio real por trás de "a agenda não abre": cadastro
 * de serviço é um passo à parte (painel Serviços) que ninguém pediu pra
 * fazer antes de tentar agendar. Chamado de toda tela que precisa da lista
 * de serviços pra agendar — idempotente (só semeia se a lista vier vazia).
 */
export async function ensureDefaultService(
  supabase: SupabaseClient,
  unit: { id: string; org_id: string | null },
  services: Service[],
): Promise<Service[]> {
  if (!unit.org_id || services.length > 0) return services
  const { data: seeded } = await supabase
    .from('services')
    .insert({ org_id: unit.org_id, unit_id: unit.id, name: 'Atendimento', duration_minutes: 60 })
    .select('*')
    .single()
  return seeded ? [seeded as Service] : services
}
