import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { launchCampaign } from '@/lib/traffic/launcher'
import type { AdAccount, CampaignCreativeDraft, NewCampaignSpec } from '@/lib/traffic/types'

export const maxDuration = 60

/**
 * Ação humana sobre um rascunho de campanha (texto + imagem) pendente de
 * aprovação — ver /api/traffic/accounts/[id]/creative-drafts (POST).
 *
 * PATCH { action: 'approve' | 'reject' }
 *   - approve: lança a campanha de verdade (launchCampaign, PAUSED nas
 *     plataformas) usando o spec do rascunho + a imagem aprovada; marca
 *     launched/launch_failed.
 *   - reject: marca 'rejected' com o e-mail de quem rejeitou — nunca lança.
 *
 * Permissão: mesma receita de content_posts/traffic_decisions — o update
 * via sessão passa pelo RLS (can_access_unit + is_org_admin); a execução
 * em si usa o service role porque grava em ad_entities/ad_actions_log.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: { action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json({ error: "action deve ser 'approve' ou 'reject'." }, { status: 400 })
  }

  const nextStatus = body.action === 'reject' ? 'rejected' : 'approved'
  const { data: updated, error } = await supabase
    .from('campaign_creative_drafts')
    .update({ status: nextStatus, decided_by: user.email })
    .eq('id', id)
    .eq('status', 'pending_approval')
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) {
    return NextResponse.json(
      { error: 'Rascunho não encontrado, já processado ou sem permissão.' },
      { status: 404 },
    )
  }

  const draft = updated as CampaignCreativeDraft

  if (body.action === 'reject') {
    return NextResponse.json({ draft: { id: draft.id, status: 'rejected' } })
  }

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })
  }

  const { data: account } = await service.from('ad_accounts').select('*').eq('id', draft.ad_account_id).single()
  if (!account) return NextResponse.json({ error: 'Conta do rascunho não encontrada.' }, { status: 404 })

  const spec: NewCampaignSpec = {
    ...draft.spec,
    creative: {
      ...draft.spec.creative,
      imageUrl: draft.image_url ?? undefined,
    },
  }

  const outcome = await launchCampaign(service, {
    account: account as AdAccount,
    spec,
    executedBy: `human_approved:${user.email}`,
  })

  await service
    .from('campaign_creative_drafts')
    .update({
      status: outcome.result === 'failed' ? 'launch_failed' : 'launched',
      launch_result: outcome,
      error_message: outcome.error ?? null,
    })
    .eq('id', draft.id)

  const status = outcome.result === 'failed' ? 502 : 200
  return NextResponse.json({ draft: { id: draft.id, status: outcome.result === 'failed' ? 'launch_failed' : 'launched' }, outcome }, { status })
}
