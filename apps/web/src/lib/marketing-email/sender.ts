// Materialização da lista + disparo real de uma campanha de e-mail
// marketing (migration 043). Chamado só na aprovação (nunca no rascunho —
// a lista pode mudar entre criar e aprovar a campanha).

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMarketingCampaignEmail } from '@/lib/email'
import { buildUnsubscribeUrl } from './unsubscribe'
import { buildAudience, fetchAudienceRows } from './audience'
import type { AudienceFilter, CampaignAudienceType, CampaignRecipientStatus } from './types'

// Lotes pequenos com uma pausa entre eles — evita estourar o rate limit
// do Resend numa campanha com muitos destinatários, sem precisar de fila
// externa (o app não tem infra de fila hoje).
const SEND_CHUNK_SIZE = 8
const SEND_CHUNK_DELAY_MS = 250

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Busca leads/customers da unidade (só as colunas necessárias pra
 * seleção), aplica a segmentação e grava o snapshot em
 * marketing_campaign_recipients — inclusive as linhas puladas
 * (opt-out/sem e-mail), para o histórico explicar por que a lista final
 * foi menor que o total de contatos da unidade.
 *
 * Idempotente: `upsert` com `ignoreDuplicates` — se a aprovação for
 * chamada de novo (ex.: retry de rede) não duplica linhas.
 */
export async function materializeCampaignRecipients(params: {
  supabase: SupabaseClient
  campaignId: string
  unitId: string
  audienceType: CampaignAudienceType
  filter: AudienceFilter
}): Promise<{ includedCount: number; skippedCount: number }> {
  const { supabase, campaignId, unitId, audienceType, filter } = params

  const { leads, customers } = await fetchAudienceRows(supabase, unitId, audienceType)
  const { included, skipped } = buildAudience({ audienceType, filter, leads, customers })

  const rows = [
    ...included.map((r) => ({
      campaign_id: campaignId,
      unit_id: unitId,
      recipient_type: r.recipientType,
      recipient_id: r.recipientId,
      email: r.email,
      unsubscribe_token: r.unsubscribeToken,
      status: 'pending' as CampaignRecipientStatus,
    })),
    ...skipped.map((r) => ({
      campaign_id: campaignId,
      unit_id: unitId,
      recipient_type: r.recipientType,
      recipient_id: r.recipientId,
      email: '',
      unsubscribe_token: r.unsubscribeToken,
      status: r.reason,
    })),
  ]

  if (rows.length > 0) {
    const { error } = await supabase
      .from('marketing_campaign_recipients')
      .upsert(rows, { onConflict: 'campaign_id,recipient_type,recipient_id', ignoreDuplicates: true })
    if (error) throw new Error(`Falha ao gravar a lista de destinatários: ${error.message}`)
  }

  return { includedCount: included.length, skippedCount: skipped.length }
}

export type DispatchOutcome = { sent: number; failed: number }

/**
 * Envia de fato os destinatários com status 'pending' da campanha, em
 * lotes pequenos, atualizando cada linha (sent/failed) e devolvendo o
 * total consolidado pra quem chama gravar em marketing_campaigns.
 */
export async function dispatchCampaign(params: {
  supabase: SupabaseClient
  campaignId: string
  unitName: string
  logoUrl: string | null
  subject: string
  bodyText: string
}): Promise<DispatchOutcome> {
  const { supabase, campaignId, unitName, logoUrl, subject, bodyText } = params

  const { data: pending, error } = await supabase
    .from('marketing_campaign_recipients')
    .select('id, recipient_type, email, unsubscribe_token')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')

  if (error) throw new Error(`Falha ao carregar destinatários pendentes: ${error.message}`)

  const recipients = (pending ?? []) as {
    id: string
    recipient_type: 'lead' | 'customer'
    email: string
    unsubscribe_token: string
  }[]

  let sent = 0
  let failed = 0

  for (let i = 0; i < recipients.length; i += SEND_CHUNK_SIZE) {
    const chunk = recipients.slice(i, i + SEND_CHUNK_SIZE)
    await Promise.all(
      chunk.map(async (recipient) => {
        const result = await sendMarketingCampaignEmail({
          to: recipient.email,
          unitName,
          logoUrl,
          subject,
          bodyText,
          unsubscribeUrl: buildUnsubscribeUrl({ recipientType: recipient.recipient_type, token: recipient.unsubscribe_token }),
        })

        if (result.ok) {
          sent += 1
          await supabase
            .from('marketing_campaign_recipients')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', recipient.id)
        } else {
          failed += 1
          await supabase
            .from('marketing_campaign_recipients')
            .update({ status: 'failed', error_message: result.error ?? 'Falha desconhecida ao enviar.' })
            .eq('id', recipient.id)
        }
      }),
    )

    if (i + SEND_CHUNK_SIZE < recipients.length) await sleep(SEND_CHUNK_DELAY_MS)
  }

  return { sent, failed }
}
