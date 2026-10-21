import { cache } from 'react'
import type { AppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveClientTargetCustomer } from '@/lib/portal-360/data'
import { BRANDING_BUCKET } from './constants'

/**
 * Leituras da marca da empresa. TODAS toleram falha: se a migration da marca ainda não existe no banco (ou o servidor não tem a chave de serviço),
 * o resultado é "sem logo própria" e o sistema segue com a logo do Alizo. Por isso isto NÃO fica dentro de getAppUser (que ler uma coluna
 * inexistente quebraria o login de todo mundo).
 */

/** Empresa cuja marca o usuário enxerga: a dele; para o cliente externo (org nula), a empresa que atende a sua conta. */
async function brandOrgIdFor(user: AppUser): Promise<string | null> {
  if (user.orgId) return user.orgId
  if (user.role === 'client' && user.clientCompany) {
    const service = createServiceClient()
    if (!service) return null
    const target = await resolveClientTargetCustomer(service, user.clientCompany).catch(() => null)
    return target?.orgId ?? null
  }
  return null
}

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

/** Logo própria do usuário logado (ou null = logo do Alizo). Uma consulta por requisição. */
export const getBrandLogoUrl = cache(async (user: AppUser): Promise<string | null> => readOrgLogoUrl(await brandOrgIdFor(user)))

/** O admin foi autorizado pelo super admin a trocar a logo da própria empresa? (super admin: sempre). */
export async function readCanManageBranding(user: Pick<AppUser, 'id' | 'isSuperAdmin' | 'role'>): Promise<boolean> {
  if (user.isSuperAdmin) return true
  if (user.role !== 'admin') return false
  try {
    const service = createServiceClient()
    if (!service) return false
    const { data, error } = await service.from('users').select('can_manage_branding').eq('id', user.id).maybeSingle()
    if (error) return false
    return Boolean((data as { can_manage_branding?: boolean } | null)?.can_manage_branding)
  } catch {
    return false
  }
}

/** Caminho do objeto no bucket de marca a partir da URL pública (para apagar a logo anterior). null se a URL não for do nosso bucket. */
export function brandingObjectPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const marker = `/storage/v1/object/public/${BRANDING_BUCKET}/`
  const i = url.indexOf(marker)
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length).split('?')[0] ?? '') || null
}
