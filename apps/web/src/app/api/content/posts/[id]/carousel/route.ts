import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { normalizeCarouselEdit } from '@/lib/content/carousel'
import { renderAndStoreCarousel } from '@/lib/content/carousel-post'
import type { ContentPost } from '@/lib/content/types'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Edita um carrossel ainda NÃO publicado: textos, ordem, quantidade de slides, CTA e fundos. Redesenha todos os slides com a marca real e troca as
 * imagens do post. Só em rascunho/aguardando aprovação — o que já foi aprovado ou publicado não muda por aqui.
 * Permissão: o update passa pelo RLS (can_access_unit + is_org_admin); sem permissão, nada é gravado.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const edit = normalizeCarouselEdit(await request.json().catch(() => null))
  if (!edit.ok) return NextResponse.json({ error: edit.error }, { status: 422 })

  const { data: row } = await supabase.from('content_posts').select('*').eq('id', id).maybeSingle()
  const post = row as ContentPost | null
  if (!post) return NextResponse.json({ error: 'Post não encontrado ou sem permissão.' }, { status: 404 })
  if (post.format !== 'carousel') return NextResponse.json({ error: 'Este post não é um carrossel.' }, { status: 409 })
  if (post.status !== 'draft' && post.status !== 'pending_approval') return NextResponse.json({ error: 'Só dá para editar um carrossel que ainda não foi aprovado.' }, { status: 409 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })
  const { data: unit } = await supabase.from('units').select('*').eq('id', post.unit_id).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })

  let stored
  try {
    const organizationProfile = await fetchOrganizationBusinessProfile(supabase, (unit as Unit).org_id ?? '')
    stored = await renderAndStoreCarousel({ supabase: service, unit: unit as Unit, organizationProfile, content: edit.value, lang: post.carousel?.lang ?? 'pt' })
  } catch (error) {
    console.error('[content/carousel edit]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível redesenhar o carrossel.' }, { status: 502 })
  }

  const { data: updated, error } = await supabase
    .from('content_posts')
    .update({ carousel: stored, image_url: stored.slide_urls[0], decided_by: user.email })
    .eq('id', id)
    .in('status', ['draft', 'pending_approval'])
    .select('id, status, image_url, carousel')
    .maybeSingle()
  if (error || !updated) return NextResponse.json({ error: 'Sem permissão ou o post mudou de estado.' }, { status: 403 })
  return NextResponse.json({ post: updated })
}
