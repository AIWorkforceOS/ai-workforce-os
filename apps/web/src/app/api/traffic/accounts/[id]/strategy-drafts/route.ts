import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getOpenAIApiKey } from '@/lib/openai'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { generateCampaignStrategy } from '@/lib/traffic/strategy-generator'
import { getMetaConfig } from '@/lib/traffic/meta-ads'
import { isImageApplicable, generateCreativeImagePrompt, generateCampaignCreativeImage, uploadCampaignCreativeImage } from '@/lib/traffic/creative-image'
import { siteUrlFrom } from '@/lib/seo/planner'
import type { AdAccount } from '@/lib/traffic/types'
import type { Unit } from '@/lib/types'

export const maxDuration = 90

/**
 * Gera uma campanha INTEIRA do zero (público, objetivo, texto, verba,
 * previsão de leads/custo) a partir da ficha real do negócio — pedido do
 * Vinicius, 2026-08-23: "o funcionário precisa de fato estudar todo o
 * negócio e público alvo e criar toda a campanha". Diferente da rota
 * antiga (accounts/[id]/creative-drafts, que exigia o `spec` pronto de
 * quem chamava), aqui é só clicar — a IA decide tudo, o humano só ajusta
 * a verba se quiser e aprova (ver PATCH creative-drafts/[id]).
 *
 * A verba proposta reutiliza o mesmo orcamento_mensal_brl aprendido na
 * entrevista de contratação (via strategyFromBusinessProfile, o motor de
 * otimização já usa isso como teto) — nunca um valor inventado.
 *
 * O link do anúncio reaproveita o site_url já aprendido pelo Especialista
 * em SEO (mesma empresa, mesmo site) — evita pedir de novo a mesma
 * informação a um funcionário diferente.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { data: visibleAccount } = await supabase.from('ad_accounts').select('id').eq('id', id).maybeSingle()
  if (!visibleAccount) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 })

  const apiKey = getOpenAIApiKey()
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY não configurada.' }, { status: 500 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })

  const { data: account } = await service.from('ad_accounts').select('*').eq('id', id).single()
  if (!account) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 })
  const adAccount = account as AdAccount

  const { data: unitRow } = await service.from('units').select('*').eq('id', adAccount.unit_id).single()
  const unit = unitRow as Unit | null

  const { data: seoConfig } = await service
    .from('agent_configs')
    .select('business_profile')
    .eq('unit_id', adAccount.unit_id)
    .eq('agent_type', 'seo_specialist')
    .maybeSingle()
  const siteUrl = siteUrlFrom((seoConfig as { business_profile?: Record<string, unknown> } | null)?.business_profile)
  if (!siteUrl) {
    return NextResponse.json(
      {
        error:
          'Nenhum site cadastrado ainda para esta empresa — complete a entrevista do Especialista em SEO informando o site (é para lá que o anúncio vai levar).',
      },
      { status: 400 },
    )
  }

  const { data: trafficConfig } = await service
    .from('agent_configs')
    .select('business_profile')
    .eq('unit_id', adAccount.unit_id)
    .eq('agent_type', 'traffic_specialist')
    .maybeSingle()
  const agentBusinessProfile = (trafficConfig as { business_profile?: Record<string, unknown> } | null)?.business_profile ?? null
  const organizationProfile = adAccount.org_id ? await fetchOrganizationBusinessProfile(service, adAccount.org_id) : null

  let metaPageId: string | null = null
  if (adAccount.platform === 'meta') {
    const { data: socialAccount } = await service
      .from('social_accounts')
      .select('page_id')
      .eq('unit_id', adAccount.unit_id)
      .eq('platform', 'meta')
      .eq('connection_status', 'connected')
      .maybeSingle()
    metaPageId = (socialAccount as { page_id?: string } | null)?.page_id ?? null
  }

  const metaConfig = adAccount.platform === 'meta' ? getMetaConfig(adAccount) : null

  let strategy
  try {
    strategy = await generateCampaignStrategy({
      apiKey,
      platform: adAccount.platform,
      organizationProfile,
      agentBusinessProfile,
      defaultConversationLanguage: unit?.default_conversation_language ?? null,
      linkUrl: siteUrl,
      metaPageId,
      metaConfig,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao gerar a estratégia da campanha.' }, { status: 502 })
  }

  const imageApplicable = isImageApplicable(adAccount.platform, strategy.spec.objective)
  let imagePrompt: string | null = null
  let imageUrl: string | null = null
  let errorMessage: string | null = null

  if (imageApplicable) {
    try {
      const { imagePrompt: prompt } = await generateCreativeImagePrompt({
        apiKey,
        platform: adAccount.platform,
        objective: strategy.spec.objective,
        creative: strategy.spec.creative,
        targeting: strategy.spec.targeting,
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

  const { data: draft, error } = await service
    .from('campaign_creative_drafts')
    .insert({
      org_id: adAccount.org_id,
      unit_id: adAccount.unit_id,
      ad_account_id: adAccount.id,
      platform: adAccount.platform,
      spec: strategy.spec,
      image_applicable: imageApplicable,
      image_prompt: imagePrompt,
      image_url: imageUrl,
      status: 'pending_approval',
      error_message: errorMessage,
      reasoning: strategy.reasoning,
      predicted_leads_min: strategy.predictedLeadsMin,
      predicted_leads_max: strategy.predictedLeadsMax,
      predicted_total_cost_cents: strategy.predictedTotalCostCents,
      prediction_period_days: strategy.predictionPeriodDays,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ draft })
}
