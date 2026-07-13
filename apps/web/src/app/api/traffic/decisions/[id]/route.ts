import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { executeDecision, isExecutable } from '@/lib/traffic/executor'
import type { AdAccount, AdEntity, TrafficDecision } from '@/lib/traffic/types'

export const maxDuration = 60

/**
 * Ação humana sobre uma decisão do Traffic Specialist.
 *
 * PATCH { action: 'approve' | 'reject' }
 *   - approve: executa a ação na plataforma (via service role) e marca
 *     executed/failed; decisões advisory apenas viram 'approved' (ciência).
 *   - reject: marca 'rejected' com o e-mail de quem rejeitou.
 *
 * Permissão: o update via sessão passa pelo RLS (can_access_unit +
 * is_org_admin) — se o usuário não pode, o update não afeta linha nenhuma.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
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

  // Update via sessão: o RLS garante que só admin da org (ou super admin)
  // consegue mover a decisão de 'suggested' para o próximo estado.
  const nextStatus = body.action === 'reject' ? 'rejected' : 'approved'
  const { data: updated, error } = await supabase
    .from('traffic_decisions')
    .update({ status: nextStatus, decided_by: user.email })
    .eq('id', id)
    .eq('status', 'suggested')
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) {
    return NextResponse.json(
      { error: 'Decisão não encontrada, já processada ou sem permissão.' },
      { status: 404 },
    )
  }

  const decision = updated as TrafficDecision

  if (body.action === 'reject') {
    return NextResponse.json({ decision: { id: decision.id, status: 'rejected' } })
  }

  // Aprovação de decisão advisory: não há nada para executar na plataforma.
  if (!isExecutable(decision.recommended_action)) {
    return NextResponse.json({ decision: { id: decision.id, status: 'approved' }, executed: false })
  }

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })
  }

  const { data: account } = await service
    .from('ad_accounts')
    .select('*')
    .eq('id', decision.ad_account_id)
    .single()
  if (!account) return NextResponse.json({ error: 'Conta da decisão não encontrada.' }, { status: 404 })

  let entity: AdEntity | null = null
  if (decision.entity_id) {
    const { data } = await service.from('ad_entities').select('*').eq('id', decision.entity_id).single()
    entity = (data as AdEntity | null) ?? null
  }

  const outcome = await executeDecision(service, {
    decision,
    account: account as AdAccount,
    entity,
    executedBy: `human_approved:${user.email}`,
  })

  if (outcome.result === 'failed') {
    return NextResponse.json(
      { decision: { id: decision.id, status: 'failed' }, executed: false, error: outcome.error },
      { status: 502 },
    )
  }
  return NextResponse.json({
    decision: { id: decision.id, status: 'executed' },
    executed: true,
    dryRun: outcome.result === 'dry_run',
  })
}
