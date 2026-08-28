import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logSystemEvent } from '@/lib/system-events'
import { getOpenAIApiKey } from '@/lib/openai'
import { QUOTA_STATUSES, contentPlatformsFrom, nextWeekDates, postingDaysFrom, shouldGenerateToday, weeklyFrequencyFrom } from '@/lib/content/planner'
import { generateSinglePostForAccount } from '@/lib/content/single-post'
import { publishDueScheduledPosts } from '@/lib/content/publisher'
import { generateWeekPostsForAccount } from '@/lib/content/weekly-planner'
import type { ContentPost, SocialAccount, SocialPlatform } from '@/lib/content/types'
import type { AgentConfig, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Loop diário do funcionário de Conteúdo/Social (Vercel Cron, ver vercel.json).
 *
 * Três fases, nessa ordem (pedido do Vinicius, 2026-08-23 — planejamento
 * semanal):
 *   1) Publica todo post 'approved' com scheduled_for = hoje (posts do
 *      planejamento semanal já aprovados, seja por humano ou por conta
 *      autônoma — ver publishDueScheduledPosts). Sempre roda, mesmo pra
 *      contas sem planejamento semanal configurado (não afeta ninguém).
 *   2) Toda sexta-feira, gera o planejamento da semana SEGUINTE (um post
 *      por dia em dias_publicacao) pra cada conta — ver generateWeekPostsForAccount.
 *   3) Fluxo avulso antigo (sem mudança de comportamento): gera um post
 *      pra HOJE quando a frequência semanal configurada permitir — mas só
 *      se hoje ainda não tiver sido coberto pelo planejamento semanal
 *      (evita gerar 2x o mesmo dia pra quem já usa o botão semanal).
 *      Contas em modo 'autonomous' publicam direto; 'suggestion' (padrão)
 *      só enfileira pra aprovação humana no dashboard.
 *
 * Não filtra por active_hours: esse campo controla disponibilidade para
 * RESPONDER conversas (SDR/Recepcionista/Recrutador), um conceito que não
 * se aplica a publicação de post agendado.
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

  // Fase 1 — publica de verdade todo post do planejamento semanal já
  // aprovado (por humano ou conta autônoma) cuja data agendada é hoje.
  // Roda sempre, independente de quem usa planejamento semanal ou não.
  const publishOutcome = await publishDueScheduledPosts(supabase)

  const { data: configs } = await supabase
    .from('agent_configs')
    .select('*, units(*)')
    .eq('agent_type', 'content_specialist')
    .eq('is_active', true)

  type ConfigWithUnit = AgentConfig & { units: Unit | null }
  const activeConfigs = ((configs ?? []) as ConfigWithUnit[]).filter((row) => row.units && row.units.is_active)

  if (activeConfigs.length === 0) {
    return NextResponse.json({
      ok: true,
      generated: 0,
      scheduledPublished: publishOutcome.published,
      message: 'Nenhum agente de conteúdo ativo.',
    })
  }

  const now = new Date()
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const isFriday = now.getUTCDay() === 5

  let totalGenerated = 0
  let totalPublished = 0
  let totalErrors = 0
  let totalWeekPlanned = 0
  const results: Record<string, unknown>[] = []

  for (const config of activeConfigs) {
    const unit = config.units as Unit

    const { count: postedToday } = await supabase
      .from('content_posts')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', unit.id)
      .gte('created_at', startOfDay.toISOString())
    const dailyLimitReached = (postedToday ?? 0) >= config.daily_limit

    const { data: accounts } = await supabase
      .from('social_accounts')
      .select('*')
      .eq('unit_id', unit.id)
      .eq('is_active', true)
      .eq('connection_status', 'connected')
    const accountRows = (accounts ?? []) as SocialAccount[]
    if (accountRows.length === 0) continue

    const profile = config.business_profile ?? {}
    const desiredPlatforms = contentPlatformsFrom(profile)

    // Fase 2 — toda sexta-feira, gera o planejamento da semana seguinte
    // (não conta pro daily_limit de hoje, é trabalho pra semana que vem).
    if (isFriday) {
      for (const account of accountRows) {
        const dates = nextWeekDates(postingDaysFrom(profile), now)
        const weekResult = await generateWeekPostsForAccount({ supabase, apiKey, config, unit, account, dates })
        totalWeekPlanned += weekResult.created
        if (weekResult.created > 0 || weekResult.errors.length > 0) {
          results.push({ unit: unit.name, account: account.page_name, weekPlan: weekResult })
        }
      }
    }

    if (dailyLimitReached) {
      results.push({ unit: unit.name, skipped: 'daily_limit atingido' })
      continue
    }

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
        .select('platform, content_pillar, visual_angle, status, created_at, scheduled_for, caption, image_prompt')
        .eq('social_account_id', account.id)
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(50)
      const recentPosts = (recent ?? []) as Pick<
        ContentPost,
        'platform' | 'content_pillar' | 'visual_angle' | 'status' | 'created_at' | 'scheduled_for' | 'caption' | 'image_prompt'
      >[]

      // O planejamento semanal já pode ter coberto hoje (post com
      // scheduled_for = hoje) — não gera um segundo post avulso pro
      // mesmo dia pra quem já usa o planejamento semanal. Mesmo achado
      // real de 2026-08-28 do weekly-planner.ts: só conta se o post ainda
      // ocupa a cota (rejeitado/com falha libera o dia de novo).
      const coveredByWeekPlan = recentPosts.some((post) => {
        if (!post.scheduled_for || !QUOTA_STATUSES.includes(post.status)) return false
        const scheduledAt = new Date(post.scheduled_for)
        return scheduledAt >= startOfDay && scheduledAt < endOfDay
      })
      if (coveredByWeekPlan) {
        results.push({ unit: unit.name, account: account.page_name, skipped: 'hoje já coberto pelo planejamento semanal' })
        continue
      }

      if (!shouldGenerateToday({ weeklyFrequency: weeklyFrequencyFrom(profile), recentPosts })) {
        results.push({ unit: unit.name, account: account.page_name, skipped: 'frequência semanal já atingida' })
        continue
      }

      const outcome = await generateSinglePostForAccount({ supabase, apiKey, config, unit, account, recentPosts })

      if (!outcome.ok) {
        totalErrors += 1
        results.push({ unit: unit.name, account: account.page_name, error: outcome.error })
        continue
      }

      totalGenerated += 1
      if (outcome.published) totalPublished += 1
      else if (outcome.publishError) totalErrors += 1
      results.push({
        unit: unit.name,
        account: account.page_name,
        platform: outcome.post.platform,
        published: outcome.published,
        ...(outcome.publishError ? { error: outcome.publishError } : {}),
      })
    }
  }

  await logSystemEvent(supabase, {
    level: totalErrors > 0 ? 'warning' : 'info',
    source: 'cron',
    eventType: 'content_specialist_run',
    message:
      `Cron do Conteúdo/Social executado: ${totalGenerated} post(s) avulso(s) gerado(s), ` +
      `${totalWeekPlanned} post(s) do planejamento semanal, ${totalPublished} publicado(s) na hora, ` +
      `${publishOutcome.published} publicado(s) agendado(s), ${totalErrors + publishOutcome.errors} erro(s).`,
    metadata: { results, isFriday },
  })

  return NextResponse.json({
    ok: true,
    generated: totalGenerated,
    weekPlanned: totalWeekPlanned,
    published: totalPublished,
    scheduledPublished: publishOutcome.published,
    errors: totalErrors + publishOutcome.errors,
  })
}
