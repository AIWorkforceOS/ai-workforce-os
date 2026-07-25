import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getOpenAIApiKey } from '@/lib/openai'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import {
  generateCampaignCreativeImage,
  generateCreativeImagePrompt,
  isImageApplicable,
  uploadCampaignCreativeImage,
} from '@/lib/traffic/creative-image'
import { validateNewCampaignSpec } from '@/lib/traffic/spec-validation'
import type { AdAccount, NewCampaignSpec } from '@/lib/traffic/types'

export const maxDuration = 60

type Body = { spec?: Partial<NewCampaignSpec> }

/**
 * Gera um RASCUNHO de campanha com criativo (texto já decidido pelo
 * chamador + imagem gerada por IA, quando a plataforma/canal usa imagem —
 * ver isImageApplicable) e o deixa pendente de aprovação humana. A
 * campanha só nasce de verdade nas plataformas (PAUSED) depois de
 * aprovada, via PATCH em creative-drafts/[id].
 *
 * Permissão: mesma receita de accounts/[id]/campaigns — o select abaixo
 * só encontra a conta se a sessão puder vê-la (RLS); a geração/gravação
 * em si usa o service role.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { data: visibleAccount } = await supabase.from('ad_accounts').select('id').eq('id', id).maybeSingle()
  if (!visibleAccount) {
    return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 })
  }

  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  const validationError = validateNewCampaignSpec(body.spec)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }
  const spec = body.spec as NewCampaignSpec

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })
  }

  const { data: account } = await service.from('ad_accounts').select('*').eq('id', id).single()
  if (!account) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 })
  const adAccount = account as AdAccount

  const imageApplicable = isImageApplicable(adAccount.platform, spec.objective)

  let imagePrompt: string | null = null
  let imageUrl: string | null = null
  let errorMessage: string | null = null

  if (imageApplicable) {
    const apiKey = getOpenAIApiKey()
    if (!apiKey) {
      errorMessage = 'OPENAI_API_KEY não configurada — rascunho criado sem imagem; pode ser aprovado assim mesmo.'
    } else {
      try {
        const { data: trafficConfig } = await service
          .from('agent_configs')
          .select('business_profile')
          .eq('unit_id', adAccount.unit_id)
          .eq('agent_type', 'traffic_specialist')
          .maybeSingle()
        const agentBusinessProfile =
          (trafficConfig as { business_profile?: Record<string, unknown> } | null)?.business_profile ?? null
        const organizationProfile = await fetchOrganizationBusinessProfile(service, adAccount.org_id)

        const { imagePrompt: prompt } = await generateCreativeImagePrompt({
          apiKey,
          platform: adAccount.platform,
          objective: spec.objective,
          creative: spec.creative,
          targeting: spec.targeting,
          organizationProfile,
          agentBusinessProfile,
        })
        const { base64Image } = await generateCampaignCreativeImage({ apiKey, imagePrompt: prompt })
        imageUrl = await uploadCampaignCreativeImage({ supabase: service, unitId: adAccount.unit_id, base64Image })
        imagePrompt = prompt
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : 'Falha desconhecida ao gerar a imagem do criativo.'
      }
    }
  }

  const { data: draft, error } = await service
    .from('campaign_creative_drafts')
    .insert({
      org_id: adAccount.org_id,
      unit_id: adAccount.unit_id,
      ad_account_id: adAccount.id,
      platform: adAccount.platform,
      spec,
      image_applicable: imageApplicable,
      image_prompt: imagePrompt,
      image_url: imageUrl,
      status: 'pending_approval',
      error_message: errorMessage,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ draft })
}
