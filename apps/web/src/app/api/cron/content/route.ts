import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isWithinActiveHours } from '@/lib/conversation-engine'
import { logSystemEvent } from '@/lib/system-events'
import { getOpenAIApiKey } from '@/lib/openai'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import {
  contentPillarsFrom,
  contentPlatformsFrom,
  decidePublishAction,
  pickNextPillar,
  pickNextPlatform,
  shouldGenerateToday,
  weeklyFrequencyFrom,
} from '@/lib/content/planner'
import { generatePostContent, generatePostImage, uploadGeneratedImage } from '@/lib/content/generator'
import { publishContentPost } from '@/lib/content/publisher'
import type { ContentPost, SocialAccount, SocialPlatform } from '@/lib/content/types'
import type { AgentConfig, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Loop diário do funcionário de Conteúdo/Social (Vercel Cron, ver vercel.json).
 *
 * Para cada unidade com agente 'content_specialist' ativo, e para cada
 * Página conectada e ativa, gera um post (legenda + imagem) quando a
 * frequência semanal configurada permitir — respeitando active_hours e
 * daily_limit de agent_configs (mesmo princípio dos crons conversacionais,
 * ver isWithinActiveHours em lib/conversation-engine.ts). Contas em modo
 * 'autonomous' publicam direto; contas em 'suggestion' (padrão) só
 * enfileiram para aprovação humana no dashboard.
 *
 * Env vars:
 *   CRON_SECRET — obrigatório (Vercel envia como Bearer token)
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') ?? ''

  if (!cronSecret) {
    console.error('[cron/content] CRON_SECRET não configurado — cron desabilitado.')
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    console.error('[cron/content] SUPABASE_SERVICE_ROLE_KEY não configurada.')
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'content',
      eventType: 'content_cron_skipped_no_openai',
      message: 'Cron de Conteúdo/Social pulado: OPENAI_API_KEY não configurada.',
    })
    return NextResponse.json({ ok: true, generated: 0, message: 'OPENAI_API_KEY não configurada.' })
  }

  const { data: configs } = await supabase
    .from('agent_configs')
    .select('*, units(*)')
    .eq('agent_type', 'content_specialist')
    .eq('is_active', true)

  type ConfigWithUnit = AgentConfig & { units: Unit | null }
  const activeConfigs = ((configs ?? []) as ConfigWithUnit[]).filter(
    (row) => row.units && row.units.is_active && isWithinActiveHours(row.active_hours),
  )

  if (activeConfigs.length === 0) {
    return NextResponse.json({ ok: true, generated: 0, message: 'Nenhum agente de conteúdo ativo dentro do horário.' })
  }

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  let totalGenerated = 0
  let totalPublished = 0
  let totalErrors = 0
  const results: Record<string, unknown>[] = []

  for (const config of activeConfigs) {
    const unit = config.units as Unit

    const { count: postedToday } = await supabase
      .from('content_posts')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', unit.id)
      .gte('created_at', startOfDay.toISOString())
    if ((postedToday ?? 0) >= config.daily_limit) {
      results.push({ unit: unit.name, skipped: 'daily_limit atingido' })
      continue
    }

    const { data: accounts } = await supabase
      .from('social_accounts')
      .select('*')
      .eq('unit_id', unit.id)
      .eq('is_active', true)
      .eq('connection_status', 'connected')
    const accountRows = (accounts ?? []) as SocialAccount[]
    if (accountRows.length === 0) continue

    const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unit.org_id)
    const profile = config.business_profile ?? {}
    const pillars = contentPillarsFrom(profile)
    const desiredPlatforms = contentPlatformsFrom(profile)

    for (const account of accountRows) {
      const supportedPlatforms: SocialPlatform[] = account.instagram_business_account_id
        ? desiredPlatforms
        : desiredPlatforms.filter((p) => p !== 'instagram')
      if (supportedPlatforms.length === 0) {
        results.push({ unit: unit.name, account: account.page_name, skipped: 'sem plataforma disponível' })
        continue
      }

      const { data: recent } = await supabase
        .from('content_posts')
        .select('platform, content_pillar, status, created_at')
        .eq('social_account_id', account.id)
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(50)
      const recentPosts = (recent ?? []) as Pick<ContentPost, 'platform' | 'content_pillar' | 'status' | 'created_at'>[]

      if (!shouldGenerateToday({ weeklyFrequency: weeklyFrequencyFrom(profile), recentPosts })) {
        results.push({ unit: unit.name, account: account.page_name, skipped: 'frequência semanal já atingida' })
        continue
      }

      const platform = pickNextPlatform(supportedPlatforms, recentPosts)
      const pillar = pickNextPillar(pillars, recentPosts)

      try {
        const content = await generatePostContent({ apiKey, config, unit, organizationProfile, platform, pillar })
        const image = await generatePostImage({ apiKey, imagePrompt: content.imagePrompt })
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
            reasoning: content.reasoning,
            mode: account.publishing_mode,
          })
          .select('*')
          .single()

        if (insertError || !inserted) {
          throw new Error(insertError?.message ?? 'Falha ao gravar o post gerado.')
        }

        totalGenerated += 1
        const post = inserted as ContentPost

        if (action === 'publish') {
          const outcome = await publishContentPost(supabase, { post, account })
          if (outcome.ok) totalPublished += 1
          else totalErrors += 1
          results.push({ unit: unit.name, account: account.page_name, platform, published: outcome.ok })
        } else {
          results.push({ unit: unit.name, account: account.page_name, platform, queued: true })
        }
      } catch (error) {
        totalErrors += 1
        results.push({
          unit: unit.name,
          account: account.page_name,
          platform,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  await logSystemEvent(supabase, {
    level: totalErrors > 0 ? 'warning' : 'info',
    source: 'cron',
    eventType: 'content_specialist_run',
    message:
      `Cron do Conteúdo/Social executado: ${totalGenerated} post(s) gerado(s), ` +
      `${totalPublished} publicado(s), ${totalErrors} erro(s).`,
    metadata: { results },
  })

  return NextResponse.json({ ok: true, generated: totalGenerated, published: totalPublished, errors: totalErrors })
}
