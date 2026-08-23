import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logSystemEvent } from '@/lib/system-events'
import { launchCampaign } from '@/lib/traffic/launcher'
import { activateLaunchedCampaign } from '@/lib/traffic/activation'
import type { AdAccount, CampaignCreativeDraft, NewCampaignSpec } from '@/lib/traffic/types'

export const maxDuration = 60

/**
 * Ação humana sobre um rascunho de campanha (texto + imagem) pendente de
 * aprovação — ver /api/traffic/accounts/[id]/creative-drafts (POST) e
 * /api/traffic/accounts/[id]/strategy-drafts (POST, geração completa por IA).
 *
 * PATCH { action: 'approve' | 'reject', dailyBudgetCents? }
 *   - approve: lança a campanha de verdade (launchCampaign) usando o spec
 *     do rascunho (com a verba substituída por dailyBudgetCents, se o
 *     humano editou) + a imagem aprovada, e IMEDIATAMENTE ativa nas
 *     plataformas — pedido do Vinicius, 2026-08-23: "o humano só clica
 *     autorizando e ele já inicia". Marca launched/launch_failed.
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

  let body: { action?: string; dailyBudgetCents?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json({ error: "action deve ser 'approve' ou 'reject'." }, { status: 400 })
  }
  if (body.dailyBudgetCents !== undefined && (!Number.isFinite(body.dailyBudgetCents) || body.dailyBudgetCents <= 0)) {
    return NextResponse.json({ error: 'dailyBudgetCents deve ser um número maior que zero.' }, { status: 400 })
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
    dailyBudgetCents: body.dailyBudgetCents ?? draft.spec.dailyBudgetCents,
    creative: {
      ...draft.spec.creative,
      imageUrl: draft.image_url ?? undefined,
    },
  }

  const adAccount = account as AdAccount
  const outcome = await launchCampaign(service, {
    account: adAccount,
    spec,
    executedBy: `human_approved:${user.email}`,
  })

  // Pedido do Vinicius, 2026-08-23: "o humano só clica autorizando e ele já
  // inicia" — a campanha nasce PAUSED nas plataformas (trava de segurança
  // do launcher), aqui ativamos na mesma tentativa, sem exigir um segundo
  // clique. Falha na ativação não desfaz o lançamento (a campanha existe
  // de verdade) — só fica registrada em error_message pra revisão manual.
  let activationError: string | null = null
  if (outcome.result === 'success' || outcome.result === 'partial') {
    try {
      await activateLaunchedCampaign(service, { account: adAccount, outcome })
    } catch (error) {
      activationError = error instanceof Error ? error.message : 'Falha desconhecida ao ativar a campanha.'
      await logSystemEvent(service, {
        level: 'error',
        source: adAccount.platform === 'meta' ? 'meta_ads' : 'google_ads',
        eventType: 'traffic_campaign_activation_failed',
        message: `Campanha "${spec.name}" (${adAccount.name}) foi criada mas não pôde ser ativada automaticamente: ${activationError}`,
        orgId: adAccount.org_id,
        unitId: adAccount.unit_id,
      })
    }
  }

  const errorMessage = [outcome.error, activationError ? `Ativação: ${activationError}` : null].filter(Boolean).join(' ') || null

  await service
    .from('campaign_creative_drafts')
    .update({
      status: outcome.result === 'failed' ? 'launch_failed' : 'launched',
      launch_result: outcome,
      error_message: errorMessage,
    })
    .eq('id', draft.id)

  const status = outcome.result === 'failed' ? 502 : 200
  return NextResponse.json({ draft: { id: draft.id, status: outcome.result === 'failed' ? 'launch_failed' : 'launched' }, outcome }, { status })
}
