import { createServiceClient } from '@/lib/supabase/service'

/** Logo própria da empresa (migration 100) lida com a chave de serviço. Falha = null (sem logo própria). Fica fora de server.ts para poder ser usada sem React (PDFs e testes). */
export async function readOrgLogoUrl(orgId: string | null): Promise<string | null> {
  if (!orgId) return null
  try {
    const service = createServiceClient()
    if (!service) return null
    const { data, error } = await service.from('organizations').select('brand_logo_url').eq('id', orgId).maybeSingle()
    if (error) return null
    const url = (data as { brand_logo_url?: string | null } | null)?.brand_logo_url
    return typeof url === 'string' && url.startsWith('https://') ? url : null
  } catch {
    return null
  }
}
