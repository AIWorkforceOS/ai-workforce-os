import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireClientProfileAdmin } from '@/lib/client-profiles/auth'
import { BRANDING_BUCKET } from '@/lib/branding/constants'
import { normalizeLogo } from '@/lib/branding/logo-processing'
import { brandingObjectPathFromUrl } from '@/lib/branding/server'

export const dynamic = 'force-dynamic'

/**
 * Logo do CLIENTE (sai nas ordens dele). Qualquer administrador da empresa pode (não depende da liberação da logo da própria empresa).
 * A existência/permissão sobre o perfil é conferida com a sessão do usuário (RLS); só a gravação do arquivo usa a chave de serviço.
 */
async function loadProfile(id: string) {
  const supabase = await createClient()
  const { data } = await supabase.from('client_company_profiles').select('id, org_id, logo_url').eq('id', id).maybeSingle()
  return { supabase, profile: data as { id: string; org_id: string; logo_url: string | null } | null }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClientProfileAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Envie o arquivo da logo.' }, { status: 400 })
  const { supabase, profile } = await loadProfile(id)
  if (!profile) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 })
  const normalized = await normalizeLogo(Buffer.from(await file.arrayBuffer()), file.type)
  if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 })
  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Servidor sem acesso de gravação configurado.' }, { status: 500 })

  const prefix = `${profile.org_id}/clients/${profile.id}/`
  const path = `${prefix}logo-${normalized.hash}.png`
  const { error: uploadError } = await service.storage.from(BRANDING_BUCKET).upload(path, normalized.data, { contentType: normalized.contentType, upsert: true, cacheControl: '31536000' })
  if (uploadError) return NextResponse.json({ error: 'Não foi possível guardar a logo. Tente de novo.' }, { status: 500 })
  const logoUrl = service.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl

  const { data: updated, error } = await supabase.from('client_company_profiles').update({ logo_url: logoUrl }).eq('id', id).select('id').maybeSingle()
  if (error || !updated) return NextResponse.json({ error: 'Não foi possível salvar a logo do cliente.' }, { status: 500 })

  const previous = brandingObjectPathFromUrl(profile.logo_url)
  if (previous && previous !== path && previous.startsWith(prefix)) await service.storage.from(BRANDING_BUCKET).remove([previous]).catch(() => undefined)
  return NextResponse.json({ ok: true, logoUrl })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClientProfileAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const { supabase, profile } = await loadProfile(id)
  if (!profile) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 })
  const { data: updated, error } = await supabase.from('client_company_profiles').update({ logo_url: null }).eq('id', id).select('id').maybeSingle()
  if (error || !updated) return NextResponse.json({ error: 'Não foi possível remover a logo.' }, { status: 500 })
  const previous = brandingObjectPathFromUrl(profile.logo_url)
  const service = createServiceClient()
  if (service && previous && previous.startsWith(`${profile.org_id}/clients/${profile.id}/`)) await service.storage.from(BRANDING_BUCKET).remove([previous]).catch(() => undefined)
  return NextResponse.json({ ok: true, logoUrl: null })
}
