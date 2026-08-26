// Geração de UM post pra uma conta social — extraído do cron diário
// (pedido do Vinicius, 2026-08-23: botão "criar conteúdo agora") pra ser
// reaproveitado tanto pelo cron quanto pela rota manual
// api/content/generate-now/route.ts, sem duplicar a lógica.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { fetchActiveAttachments, buildAttachmentsContext } from '@/lib/attachments'
import { contentPillarsFrom, contentPlatformsFrom, decidePublishAction, pickNextPillar, pickNextPlatform } from './planner'
import { generatePostContent, generatePostImage, uploadGeneratedImage } from './generator'
import { holidayOnDate } from './holidays'
import { publishContentPost } from './publisher'
import type { ContentPost, SocialAccount, SocialPlatform } from './types'
import type { AgentConfig, Unit } from '@/lib/types'

export type SinglePostResult =
  | { ok: true; post: ContentPost; published: boolean; publishError?: string }
  | { ok: false; error: string }

/**
 * Gera e grava um post pra uma conta — publica na hora se a conta for
 * autônoma E o post for pra hoje/imediato (scheduledFor ausente ou não
 * futuro); post com scheduledFor no futuro (planejamento semanal) nunca
 * publica aqui, só marca approved/pending_approval e espera o cron do dia.
 */
export async function generateSinglePostForAccount(params: {
  supabase: SupabaseClient
  apiKey: string
  config: AgentConfig
  unit: Unit
  account: SocialAccount
  recentPosts: Pick<ContentPost, 'platform' | 'content_pillar' | 'created_at' | 'caption' | 'image_prompt'>[]
  scheduledFor?: Date | null
}): Promise<SinglePostResult> {
  const { supabase, apiKey, config, unit, account, recentPosts, scheduledFor } = params
  const profile = config.business_profile ?? {}

  const desiredPlatforms = contentPlatformsFrom(profile)
  const supportedPlatforms: SocialPlatform[] = account.instagram_business_account_id
    ? desiredPlatforms
    : desiredPlatforms.filter((p) => p !== 'instagram')
  if (supportedPlatforms.length === 0) {
    return { ok: false, error: 'Nenhuma plataforma disponível para esta conta (Instagram não vinculado à Página).' }
  }

  const pillars = contentPillarsFrom(profile)
  const platform = pickNextPlatform(supportedPlatforms, recentPosts)
  const pillar = pickNextPillar(pillars, recentPosts)
  const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unit.org_id)
  const attachments = await fetchActiveAttachments(supabase, unit, 'content_specialist')
  const attachmentsContext = buildAttachmentsContext(attachments)
  const holiday = scheduledFor ? holidayOnDate(scheduledFor) : null
  const recentPostsContext = [...recentPosts]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((p) => ({ pillar: p.content_pillar, caption: p.caption, imagePrompt: p.image_prompt }))

  try {
    const content = await generatePostContent({
      apiKey,
      config,
      unit,
      organizationProfile,
      platform,
      pillar,
      holiday: holiday?.name ?? null,
      recentPosts: recentPostsContext,
      attachmentsContext,
    })
    const logoUrl = (organizationProfile as { brand_kit?: { logo_url?: string | null } } | null)?.brand_kit?.logo_url ?? null
    const image = await generatePostImage({ apiKey, imagePrompt: content.imagePrompt, logoUrl })
    const imageUrl = await uploadGeneratedImage({ supabase, unitId: unit.id, base64Image: image.base64Image })

    const action = decidePublishAction(account.publishing_mode)
    const { data: inserted, error: insertError } = await supabase
      .from('content_posts')
      .insert({
        org_id: unit.org_id,
        unit_id: unit.id,
        social_account_id: account.id,
        platform,
        status: action === 'publish' ? 'approved' : 'pending_approval',
        content_pillar: pillar,
        caption: content.caption,
        image_prompt: content.imagePrompt,
        image_url: imageUrl,
        reasoning: holiday ? `${content.reasoning} (${holiday.name})` : content.reasoning,
        mode: account.publishing_mode,
        scheduled_for: scheduledFor ? scheduledFor.toISOString() : null,
      })
      .select('*')
      .single()

    if (insertError || !inserted) throw new Error(insertError?.message ?? 'Falha ao gravar o post gerado.')
    const post = inserted as ContentPost

    const isFuture = Boolean(scheduledFor && scheduledFor.getTime() > Date.now())
    if (action === 'publish' && !isFuture) {
      const outcome = await publishContentPost(supabase, { post, account })
      return outcome.ok ? { ok: true, post, published: true } : { ok: true, post, published: false, publishError: outcome.error }
    }
    return { ok: true, post, published: false }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
