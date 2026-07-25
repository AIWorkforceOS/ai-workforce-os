import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildAudience, fetchAudienceRows } from '@/lib/marketing-email/audience'
import type { MarketingCampaign } from '@/lib/marketing-email/types'

export const maxDuration = 30

/**
 * Prévia (sem gravar nada) de quantos destinatários uma campanha
 * pending_approval atingiria se aprovada agora — pro humano decidir com
 * informação antes de disparar pra uma lista inteira. A contagem real,
 * materializada, só acontece na aprovação (lib/marketing-email/sender.ts),
 * porque a lista pode mudar entre esta prévia e o clique em aprovar.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { data: campaignData } = await supabase
    .from('marketing_campaigns')
    .select('unit_id, audience_type, audience_filter')
    .eq('id', id)
    .maybeSingle()
  if (!campaignData) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 })
  const campaign = campaignData as Pick<MarketingCampaign, 'unit_id' | 'audience_type' | 'audience_filter'>

  const { leads, customers } = await fetchAudienceRows(supabase, campaign.unit_id, campaign.audience_type)
  const { included, skipped } = buildAudience({ audienceType: campaign.audience_type, filter: campaign.audience_filter, leads, customers })

  return NextResponse.json({ total: included.length, skipped: skipped.length })
}
