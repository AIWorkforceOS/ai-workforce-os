import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { materializeCampaignRecipients, dispatchCampaign } from '@/lib/marketing-email/sender'
import type { MarketingCampaign } from '@/lib/marketing-email/types'
import type { Unit } from '@/lib/types'

export const maxDuration = 300

/**
 * Ação humana sobre uma campanha pendente de aprovação — mesmo espírito de
 * /api/content/posts/[id]: approve | reject | edit.
 *
 * 'approve' materializa a lista de destinatários NA HORA (nunca antes —
 * o público pode ter mudado desde o rascunho) e dispara de verdade via
 * Resend, em lotes (lib/marketing-email/sender.ts). Nunca dispara sozinho
 * fora desta ação — diferente do Conteúdo/Social, esta campanha não tem
 * modo autônomo nesta primeira versão (risco de reputação/spam do envio
 * em massa).
 *
 * Permissão: todas as leituras/escritas abaixo passam pela sessão — a RLS
 * (can_access_unit + is_org_admin) garante que só admin da org mexe.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: { action?: string; subject?: string; body_text?: string; audience_type?: string; audience_filter?: unknown }
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
    if (typeof body.subject === 'string' && body.subject.trim().length > 0) updates.subject = body.subject.trim()
    if (typeof body.body_text === 'string' && body.body_text.trim().length > 0) updates.body_text = body.body_text.trim()
    if (body.audience_type === 'leads' || body.audience_type === 'customers' || body.audience_type === 'both') {
      updates.audience_type = body.audience_type
    }
    if (body.audience_filter && typeof body.audience_filter === 'object') updates.audience_filter = body.audience_filter

    const { data: updated, error } = await supabase
      .from('marketing_campaigns')
      .update(updates)
      .eq('id', id)
      .eq('status', 'pending_approval')
      .select('*')
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!updated) {
      return NextResponse.json({ error: 'Campanha não encontrada, já processada ou sem permissão.' }, { status: 404 })
    }
    return NextResponse.json({ campaign: updated })
  }

  if (body.action === 'reject') {
    const { data: updated, error } = await supabase
      .from('marketing_campaigns')
      .update({ status: 'rejected', decided_by: user.email })
      .eq('id', id)
      .eq('status', 'pending_approval')
      .select('id, status')
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!updated) {
      return NextResponse.json({ error: 'Campanha não encontrada, já processada ou sem permissão.' }, { status: 404 })
    }
    return NextResponse.json({ campaign: updated })
  }

  // approve: trava a linha (só sai de pending_approval uma vez) antes de disparar
  const { data: locked, error: lockError } = await supabase
    .from('marketing_campaigns')
    .update({ status: 'sending', decided_by: user.email })
    .eq('id', id)
    .eq('status', 'pending_approval')
    .select('*')
    .maybeSingle()

  if (lockError) return NextResponse.json({ error: lockError.message }, { status: 500 })
  if (!locked) {
    return NextResponse.json({ error: 'Campanha não encontrada, já processada ou sem permissão.' }, { status: 404 })
  }
  const campaign = locked as MarketingCampaign

  const { data: unitData } = await supabase.from('units').select('*').eq('id', campaign.unit_id).maybeSingle()
  if (!unitData) {
    await supabase.from('marketing_campaigns').update({ status: 'failed', error_message: 'Unidade não encontrada.' }).eq('id', id)
    return NextResponse.json({ error: 'Unidade da campanha não encontrada.' }, { status: 404 })
  }
  const unit = unitData as Unit

  try {
    const { includedCount, skippedCount } = await materializeCampaignRecipients({
      supabase,
      campaignId: campaign.id,
      unitId: unit.id,
      audienceType: campaign.audience_type,
      filter: campaign.audience_filter,
    })

    if (includedCount === 0) {
      await supabase
        .from('marketing_campaigns')
        .update({
          status: 'failed',
          recipients_total: 0,
          recipients_skipped: skippedCount,
          error_message: 'Nenhum destinatário elegível (todos sem e-mail válido ou descadastrados) para o segmento escolhido.',
        })
        .eq('id', id)
      return NextResponse.json(
        { error: 'Nenhum destinatário elegível para o segmento escolhido.' },
        { status: 422 },
      )
    }

    const { sent, failed } = await dispatchCampaign({
      supabase,
      campaignId: campaign.id,
      unitName: unit.name,
      logoUrl: unit.logo_url,
      subject: campaign.subject,
      bodyText: campaign.body_text,
    })

    const finalStatus = sent > 0 ? 'sent' : 'failed'
    const { data: finished } = await supabase
      .from('marketing_campaigns')
      .update({
        status: finalStatus,
        recipients_total: includedCount,
        recipients_sent: sent,
        recipients_failed: failed,
        recipients_skipped: skippedCount,
        sent_at: new Date().toISOString(),
        error_message: finalStatus === 'failed' ? 'Todos os envios falharam — confira RESEND_API_KEY/EMAIL_FROM_DOMAIN.' : null,
      })
      .eq('id', id)
      .select('id, status, recipients_total, recipients_sent, recipients_failed, recipients_skipped')
      .maybeSingle()

    return NextResponse.json({ campaign: finished, sent, failed, skipped: skippedCount })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao enviar a campanha.'
    await supabase.from('marketing_campaigns').update({ status: 'failed', error_message: message }).eq('id', id)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
