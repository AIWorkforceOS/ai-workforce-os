import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { publishContentPost } from '@/lib/content/publisher'
import type { ContentPost, SocialAccount } from '@/lib/content/types'

export const maxDuration = 60

/**
 * Ação humana sobre um post da fila de conteúdo.
 *
 * PATCH { action: 'approve' | 'reject' | 'edit', caption?, image_url? }
 *   - approve: publica de verdade na plataforma (via service role) e marca
 *     published/failed.
 *   - reject: marca 'rejected' com o e-mail de quem rejeitou — nunca publica.
 *   - edit: troca legenda e/ou imagem antes de aprovar (só permitido
 *     enquanto o post ainda não foi publicado).
 *
 * Permissão: o update via sessão passa pelo RLS (can_access_unit +
 * is_org_admin) — se o usuário não pode, o update não afeta linha nenhuma.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: { action?: string; caption?: string; image_url?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  if (body.action !== 'approve' && body.action !== 'reject' && body.action !== 'edit') {
    return NextResponse.json({ error: "action deve ser 'approve', 'reject' ou 'edit'." }, { status: 400 })
  }

  if (body.action === 'edit') {
    const updates: Record<string, unknown> = { decided_by: user.email }
    if (typeof body.caption === 'string' && body.caption.trim().length > 0) updates.caption = body.caption.trim()
    if (typeof body.image_url === 'string' && body.image_url.trim().length > 0) updates.image_url = body.image_url.trim()

    const { data: updated, error } = await supabase
      .from('content_posts')
      .update(updates)
      .eq('id', id)
      .in('status', ['draft', 'pending_approval'])
      .select('id, caption, image_url, status')
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!updated) {
      return NextResponse.json({ error: 'Post não encontrado, já publicado ou sem permissão.' }, { status: 404 })
    }
    return NextResponse.json({ post: updated })
  }

  const nextStatus = body.action === 'reject' ? 'rejected' : 'approved'
  const { data: updated, error } = await supabase
    .from('content_posts')
    .update({ status: nextStatus, decided_by: user.email })
    .eq('id', id)
    .in('status', ['draft', 'pending_approval'])
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) {
    return NextResponse.json(
      { error: 'Post não encontrado, já processado ou sem permissão.' },
      { status: 404 },
    )
  }

  const post = updated as ContentPost

  if (body.action === 'reject') {
    return NextResponse.json({ post: { id: post.id, status: 'rejected' } })
  }

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })
  }

  const { data: account } = await service
    .from('social_accounts')
    .select('*')
    .eq('id', post.social_account_id)
    .single()
  if (!account) return NextResponse.json({ error: 'Conta do post não encontrada.' }, { status: 404 })

  const outcome = await publishContentPost(service, { post, account: account as SocialAccount })

  if (!outcome.ok) {
    return NextResponse.json(
      { post: { id: post.id, status: 'failed' }, published: false, error: outcome.error },
      { status: 502 },
    )
  }
  return NextResponse.json({ post: { id: post.id, status: 'published' }, published: true })
}
