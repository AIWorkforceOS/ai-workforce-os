import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getOpenAIApiKey } from '@/lib/openai'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { normalizeVideoEdit } from '@/lib/content/video'
import { renderAndStoreVideo } from '@/lib/content/video-post'
import type { ContentPost } from '@/lib/content/types'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Edita um vídeo ainda NÃO aprovado: roteiro, textos das cenas, duração, transições, ordem, fotos de fundo e chamada para ação. Redesenha os quadros com a
 * marca real, recodifica o MP4 e troca o arquivo do post. O que já foi aprovado ou publicado não muda por aqui.
 * Permissão: o update passa pelo RLS (can_access_unit + is_org_admin); sem permissão, nada é gravado.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const edit = normalizeVideoEdit(await request.json().catch(() => null))
  if (!edit.ok) return NextResponse.json({ error: edit.error }, { status: 422 })

  const { data: row } = await supabase.from('content_posts').select('*').eq('id', id).maybeSingle()
  const post = row as ContentPost | null
  if (!post) return NextResponse.json({ error: 'Post não encontrado ou sem permissão.' }, { status: 404 })
  if (post.format !== 'video') return NextResponse.json({ error: 'Este post não é um vídeo.' }, { status: 409 })
  if (post.status !== 'draft' && post.status !== 'pending_approval') return NextResponse.json({ error: 'Só dá para editar um vídeo que ainda não foi aprovado.' }, { status: 409 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })
  const { data: unit } = await supabase.from('units').select('*').eq('id', post.unit_id).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })

  let stored
  try {
    const organizationProfile = await fetchOrganizationBusinessProfile(supabase, (unit as Unit).org_id ?? '')
    stored = await renderAndStoreVideo({ supabase: service, unit: unit as Unit, organizationProfile, content: { ...edit.value, brand_name: post.video?.brand_name }, lang: post.video?.lang ?? 'pt', apiKey: getOpenAIApiKey() })
  } catch (error) {
    console.error('[content/video edit]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível renderizar o vídeo.' }, { status: 502 })
  }

  const { data: updated, error } = await supabase
    .from('content_posts')
    .update({ video: stored, image_url: stored.poster_url, decided_by: user.email })
    .eq('id', id)
    .in('status', ['draft', 'pending_approval'])
    .select('id, status, image_url, video')
    .maybeSingle()
  if (error || !updated) return NextResponse.json({ error: 'Sem permissão ou o post mudou de estado.' }, { status: 403 })
  return NextResponse.json({ post: updated })
}
