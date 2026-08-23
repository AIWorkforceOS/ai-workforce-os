import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Identidade visual da marca (logo + paleta), pedido do Vinicius
 * 2026-08-23: pra manter consistência visual nos posts gerados pelo
 * Gestor de Conteúdo em vez de visual genérico/aleatório a cada post.
 * Guardado em organizations.business_profile.brand_kit (ficha
 * COMPARTILHADA — vale pra todos os funcionários digitais da org, não só
 * o de Conteúdo), lido em lib/content/generator.ts.
 *
 * PATCH { unit_id, logo_url?, primary_color?, secondary_color? }
 *
 * organizations só aceita UPDATE via RLS de super_admin (migration 005) —
 * mesmo padrão de content/posts/[id]/route.ts: a sessão confirma que o
 * usuário tem acesso à unidade (e portanto à org dela), e quem grava de
 * fato é o service role.
 */

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: { unit_id?: string; logo_url?: string | null; primary_color?: string | null; secondary_color?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  if (!body.unit_id) return NextResponse.json({ error: 'unit_id é obrigatório.' }, { status: 400 })
  for (const [field, value] of [['primary_color', body.primary_color], ['secondary_color', body.secondary_color]] as const) {
    if (value != null && value !== '' && !HEX_COLOR.test(value)) {
      return NextResponse.json({ error: `${field} deve ser uma cor hex válida, ex: #1E40AF.` }, { status: 400 })
    }
  }

  // RLS de units já restringe a leitura à(s) unidade(s) que este usuário pode acessar.
  const { data: unit } = await supabase.from('units').select('id, org_id').eq('id', body.unit_id).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada ou sem permissão.' }, { status: 404 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })

  const { data: org } = await service.from('organizations').select('business_profile').eq('id', unit.org_id).maybeSingle()
  const currentProfile = (org?.business_profile ?? {}) as Record<string, unknown>
  const currentBrandKit = (currentProfile.brand_kit ?? {}) as Record<string, unknown>

  const nextBrandKit: Record<string, unknown> = { ...currentBrandKit }
  if (body.logo_url !== undefined) nextBrandKit.logo_url = body.logo_url || null
  if (body.primary_color !== undefined) nextBrandKit.primary_color = body.primary_color || null
  if (body.secondary_color !== undefined) nextBrandKit.secondary_color = body.secondary_color || null

  const { error } = await service
    .from('organizations')
    .update({ business_profile: { ...currentProfile, brand_kit: nextBrandKit } })
    .eq('id', unit.org_id)

  if (error) return NextResponse.json({ error: 'Não foi possível salvar a identidade visual. Tente de novo.' }, { status: 500 })

  return NextResponse.json({ brand_kit: nextBrandKit })
}
