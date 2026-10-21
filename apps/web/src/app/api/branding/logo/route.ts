import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { BRANDING_BUCKET } from '@/lib/branding/constants'
import { logoObjectPath, normalizeLogo } from '@/lib/branding/logo-processing'
import { canEditOrgBranding } from '@/lib/branding/permissions'
import { brandingObjectPathFromUrl, readCanManageBranding, readOrgLogoUrl } from '@/lib/branding/server'

export const dynamic = 'force-dynamic'

/**
 * Troca/remove a logo da empresa. Autorização: super admin (qualquer empresa) ou admin da empresa COM a permissão liberada pelo super admin
 * (users.can_manage_branding), só da própria empresa. A imagem é validada e reprocessada no servidor; a gravação usa a chave de serviço
 * (o bucket não tem política de escrita para usuários e `organizations` só aceita escrita do super admin pelo banco).
 */
async function authorize(targetOrgParam: unknown) {
  const appUser = await getAppUser()
  if (!appUser) return { ok: false as const, response: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) }
  // Só o super admin escolhe a empresa; qualquer outro usuário só age sobre a própria (um orgId enviado por ele é ignorado).
  const targetOrgId = appUser.isSuperAdmin && typeof targetOrgParam === 'string' && targetOrgParam ? targetOrgParam : appUser.orgId
  const canManage = await readCanManageBranding(appUser)
  if (!canEditOrgBranding({ role: appUser.role, orgId: appUser.orgId, isSuperAdmin: appUser.isSuperAdmin, canManageBranding: canManage }, targetOrgId)) {
    return { ok: false as const, response: NextResponse.json({ error: 'Você não tem permissão para trocar a logo. Peça à equipe Alizo para liberar este acesso.' }, { status: 403 }) }
  }
  const service = createServiceClient()
  if (!service) return { ok: false as const, response: NextResponse.json({ error: 'Servidor sem acesso de gravação configurado.' }, { status: 500 }) }
  return { ok: true as const, appUser, targetOrgId: targetOrgId as string, service }
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })
  const auth = await authorize(form.get('orgId'))
  if (!auth.ok) return auth.response
  const { appUser, targetOrgId, service } = auth

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Envie o arquivo da logo.' }, { status: 400 })
  const normalized = await normalizeLogo(Buffer.from(await file.arrayBuffer()), file.type)
  if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 })

  const previousUrl = await readOrgLogoUrl(targetOrgId)
  const path = logoObjectPath(targetOrgId, normalized.hash)
  const { error: uploadError } = await service.storage.from(BRANDING_BUCKET).upload(path, normalized.data, { contentType: normalized.contentType, upsert: true, cacheControl: '31536000' })
  if (uploadError) return NextResponse.json({ error: 'Não foi possível guardar a logo. Tente de novo.' }, { status: 500 })
  const logoUrl = service.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl

  const { error: updateError } = await service
    .from('organizations')
    .update({ brand_logo_url: logoUrl, brand_logo_updated_at: new Date().toISOString(), brand_logo_updated_by: appUser.id })
    .eq('id', targetOrgId)
  if (updateError) return NextResponse.json({ error: 'Não foi possível salvar a logo da empresa.' }, { status: 500 })

  // apaga a logo anterior (nome com hash: nunca sobrescreve a atual) — falha aqui não afeta o resultado
  const previousPath = brandingObjectPathFromUrl(previousUrl)
  if (previousPath && previousPath !== path && previousPath.startsWith(`${targetOrgId}/`)) await service.storage.from(BRANDING_BUCKET).remove([previousPath]).catch(() => undefined)

  return NextResponse.json({ ok: true, logoUrl })
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as { orgId?: unknown } | null
  const auth = await authorize(body?.orgId)
  if (!auth.ok) return auth.response
  const { appUser, targetOrgId, service } = auth
  const previousUrl = await readOrgLogoUrl(targetOrgId)
  const { error } = await service.from('organizations').update({ brand_logo_url: null, brand_logo_updated_at: new Date().toISOString(), brand_logo_updated_by: appUser.id }).eq('id', targetOrgId)
  if (error) return NextResponse.json({ error: 'Não foi possível remover a logo.' }, { status: 500 })
  const previousPath = brandingObjectPathFromUrl(previousUrl)
  if (previousPath && previousPath.startsWith(`${targetOrgId}/`)) await service.storage.from(BRANDING_BUCKET).remove([previousPath]).catch(() => undefined)
  return NextResponse.json({ ok: true, logoUrl: null })
}
