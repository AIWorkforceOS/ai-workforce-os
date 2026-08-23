import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logSystemEvent } from '@/lib/system-events'
import { getOpenAIApiKey } from '@/lib/openai'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { runSeoAudit } from '@/lib/seo/audit'
import { generateSeoContent, generateSeoImage, uploadSeoImage } from '@/lib/seo/generator'
import {
  pickNextContentType,
  pickNextKeyword,
  seoKeywordsFrom,
  shouldGenerateContentToday,
  shouldRunAuditToday,
  siteUrlFrom,
} from '@/lib/seo/planner'
import { checkKeywordRanking, getSerpApiKey } from '@/lib/seo/rank-tracking'
import { fetchSearchConsolePerformance } from '@/lib/seo/search-console'
import { getGoogleSearchConsoleCredentials, refreshAccessToken } from '@/lib/seo/search-console-oauth'
import type { SeoContentItem, SeoKeyword, SeoSearchConsoleAccount } from '@/lib/seo/types'
import type { AgentConfig, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Loop diário do funcionário digital de SEO (Vercel Cron, ver
 * vercel.json). Para cada unidade com agente 'seo_specialist' ativo e com
 * site_url já aprendido na entrevista:
 *
 *   1) Auditoria técnica — a cada 7 dias (site raramente muda de
 *      estrutura de um dia pro outro), sempre roda (não depende de
 *      OPENAI_API_KEY — é só fetch + parsing).
 *   2) Conteúdo (blog/landing/GBP) — depende de OPENAI_API_KEY; sem ela,
 *      só este passo é pulado (a auditoria continua rodando).
 *   3) Rank tracking — depende de SERP_API_KEY; sem ela, este passo
 *      inteiro é pulado (log único, não quebra o resto).
 *   4) Desempenho real (Google Search Console) — só pra unidades que já
 *      conectaram (dashboard/seo, botão "Conectar Google Search Console");
 *      cadência semanal (dados da API têm ~3 dias de atraso, não faz
 *      sentido consultar todo dia). Renova o access token a partir do
 *      refresh token salvo antes de cada consulta.
 *
 * Env vars:
 *   CRON_SECRET — obrigatório (Vercel envia como Bearer token)
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') ?? ''

  if (!cronSecret) {
    console.error('[cron/seo] CRON_SECRET não configurado — cron desabilitado.')
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    console.error('[cron/seo] SUPABASE_SERVICE_ROLE_KEY não configurada.')
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const { data: configs } = await supabase
    .from('agent_configs')
    .select('*, units(*)')
    .eq('agent_type', 'seo_specialist')
    .eq('is_active', true)

  // Não filtra por active_hours: esse campo controla disponibilidade para
  // RESPONDER conversas (SDR/Recepcionista/Recrutador), um conceito que não
  // se aplica a auditoria técnica / geração de conteúdo / rank-tracking —
  // trabalho assíncrono e agendado, não resposta de chat em tempo real.
  type ConfigWithUnit = AgentConfig & { units: Unit | null }
  const activeConfigs = ((configs ?? []) as ConfigWithUnit[]).filter((row) => row.units && row.units.is_active)

  if (activeConfigs.length === 0) {
    return NextResponse.json({ ok: true, message: 'Nenhum agente de SEO ativo.' })
  }

  const apiKey = getOpenAIApiKey()
  const serpApiKey = getSerpApiKey()
  const gscCredentials = getGoogleSearchConsoleCredentials()
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const sevenDaysAgoDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const sevenDaysAgo = sevenDaysAgoDate.toISOString()
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)

  let auditsRun = 0
  let contentGenerated = 0
  let rankingsChecked = 0
  let gscSnapshotsFetched = 0
  let errorsCount = 0
  const results: Record<string, unknown>[] = []

  for (const config of activeConfigs) {
    const unit = config.units as Unit
    const profile = config.business_profile ?? {}
    const siteUrl = siteUrlFrom(profile)

    if (!siteUrl) {
      results.push({ unit: unit.name, skipped: 'entrevista ainda sem site_url' })
      continue
    }
    if (!unit.org_id) {
      results.push({ unit: unit.name, skipped: 'unidade sem organização vinculada' })
      continue
    }

    // 1) Auditoria técnica (cadência de 7 dias)
    try {
      const { data: lastAudit } = await supabase
        .from('seo_audits')
        .select('created_at')
        .eq('unit_id', unit.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const lastAuditAt = (lastAudit as { created_at: string } | null)?.created_at ?? null

      if (shouldRunAuditToday({ lastAuditAt })) {
        const auditResult = await runSeoAudit({ siteUrl })
        await supabase.from('seo_audits').insert({
          org_id: unit.org_id,
          unit_id: unit.id,
          site_url: siteUrl,
          score: auditResult.score,
          checks: auditResult.checks,
          error_message: auditResult.errorMessage,
        })
        auditsRun += 1
        results.push({ unit: unit.name, audit: 'rodada', score: auditResult.score })
      }
    } catch (error) {
      errorsCount += 1
      results.push({ unit: unit.name, auditError: error instanceof Error ? error.message : String(error) })
    }

    // 2) Conteúdo (blog/landing/GBP) — precisa de OPENAI_API_KEY
    if (!apiKey) {
      results.push({ unit: unit.name, content: 'pulado — OPENAI_API_KEY não configurada' })
    } else {
      try {
        const { count: createdToday } = await supabase
          .from('seo_content_items')
          .select('id', { count: 'exact', head: true })
          .eq('unit_id', unit.id)
          .gte('created_at', startOfDay.toISOString())

        if ((createdToday ?? 0) >= config.daily_limit) {
          results.push({ unit: unit.name, content: 'daily_limit atingido' })
        } else {
          const { data: recent } = await supabase
            .from('seo_content_items')
            .select('content_type, target_keyword, created_at')
            .eq('unit_id', unit.id)
            .gte('created_at', sevenDaysAgo)
            .order('created_at', { ascending: false })
            .limit(50)
          const recentItems = (recent ?? []) as Pick<SeoContentItem, 'content_type' | 'target_keyword' | 'created_at'>[]

          if (shouldGenerateContentToday({ recentItems })) {
            const contentType = pickNextContentType(recentItems)
            const keywords = seoKeywordsFrom(profile)
            const keyword = pickNextKeyword({ contentType, keywords, recentItems })
            const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unit.org_id)

            const content = await generateSeoContent({ apiKey, config, unit, organizationProfile, contentType, keyword })

            let imageUrl: string | null = null
            if (content.imagePrompt) {
              try {
                const image = await generateSeoImage({ apiKey, imagePrompt: content.imagePrompt })
                imageUrl = await uploadSeoImage({ supabase, unitId: unit.id, base64Image: image.base64Image })
              } catch {
                // imagem é melhor-esforço — segue sem imagem em vez de falhar o item inteiro
              }
            }

            const { error: insertError } = await supabase.from('seo_content_items').insert({
              org_id: unit.org_id,
              unit_id: unit.id,
              content_type: contentType,
              status: 'pending_approval',
              target_keyword: keyword,
              title: content.title,
              meta_description: content.metaDescription,
              body_markdown: content.bodyMarkdown,
              image_prompt: content.imagePrompt,
              image_url: imageUrl,
              reasoning: content.reasoning,
            })
            if (insertError) throw new Error(insertError.message)

            contentGenerated += 1
            results.push({ unit: unit.name, content: contentType, keyword })
          }
        }
      } catch (error) {
        errorsCount += 1
        results.push({ unit: unit.name, contentError: error instanceof Error ? error.message : String(error) })
      }
    }

    // 3) Rank tracking — precisa de SERP_API_KEY
    if (serpApiKey) {
      try {
        const { data: keywordRows } = await supabase
          .from('seo_keywords')
          .select('*')
          .eq('unit_id', unit.id)
          .eq('is_active', true)
        const keywordsList = (keywordRows ?? []) as SeoKeyword[]

        for (const trackedKeyword of keywordsList) {
          const { data: lastRanking } = await supabase
            .from('seo_keyword_rankings')
            .select('checked_at')
            .eq('keyword_id', trackedKeyword.id)
            .order('checked_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          const lastCheckedAt = (lastRanking as { checked_at: string } | null)?.checked_at
          if (lastCheckedAt && new Date(lastCheckedAt) > threeDaysAgo) continue

          const rankingResult = await checkKeywordRanking({ keyword: trackedKeyword.keyword, siteUrl })
          if (rankingResult.status === 'ok') {
            await supabase.from('seo_keyword_rankings').insert({
              org_id: unit.org_id,
              unit_id: unit.id,
              keyword_id: trackedKeyword.id,
              position: rankingResult.position,
            })
            rankingsChecked += 1
          } else if (rankingResult.status === 'error') {
            results.push({ unit: unit.name, keyword: trackedKeyword.keyword, rankingError: rankingResult.message })
          }
        }
      } catch (error) {
        errorsCount += 1
        results.push({ unit: unit.name, rankingError: error instanceof Error ? error.message : String(error) })
      }
    }

    // 4) Desempenho real (Google Search Console) — só quem já conectou
    if (gscCredentials) {
      try {
        const { data: gscAccountRow } = await supabase
          .from('seo_search_console_accounts')
          .select('*')
          .eq('unit_id', unit.id)
          .maybeSingle()
        const gscAccount = gscAccountRow as SeoSearchConsoleAccount | null

        if (gscAccount) {
          const { data: lastSnapshot } = await supabase
            .from('seo_search_console_snapshots')
            .select('created_at')
            .eq('unit_id', unit.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          const lastSnapshotAt = (lastSnapshot as { created_at: string } | null)?.created_at ?? null

          if (!lastSnapshotAt || new Date(lastSnapshotAt) <= sevenDaysAgoDate) {
            const { accessToken } = await refreshAccessToken({
              refreshToken: gscAccount.refresh_token,
              clientId: gscCredentials.clientId,
              clientSecret: gscCredentials.clientSecret,
            })

            const performance = await fetchSearchConsolePerformance({ siteUrl: gscAccount.site_url, accessToken })
            await supabase.from('seo_search_console_snapshots').insert({
              org_id: unit.org_id,
              unit_id: unit.id,
              period_start: performance.periodStart,
              period_end: performance.periodEnd,
              total_clicks: performance.totalClicks,
              total_impressions: performance.totalImpressions,
              avg_ctr: performance.avgCtr,
              avg_position: performance.avgPosition,
              top_queries: performance.topQueries,
            })
            await supabase
              .from('seo_search_console_accounts')
              .update({ access_token: accessToken, connection_status: 'connected', connection_error: null })
              .eq('id', gscAccount.id)

            gscSnapshotsFetched += 1
            results.push({ unit: unit.name, gsc: 'atualizado', clicks: performance.totalClicks })
          }
        }
      } catch (error) {
        errorsCount += 1
        const message = error instanceof Error ? error.message : String(error)
        results.push({ unit: unit.name, gscError: message })
        await supabase
          .from('seo_search_console_accounts')
          .update({ connection_status: 'error', connection_error: message })
          .eq('unit_id', unit.id)
      }
    }
  }

  if (!serpApiKey) {
    await logSystemEvent(supabase, {
      level: 'info',
      source: 'seo',
      eventType: 'seo_rank_tracking_skipped_no_key',
      message: 'Acompanhamento de posição de palavra-chave pulado: SERP_API_KEY não configurada.',
    })
  }

  await logSystemEvent(supabase, {
    level: errorsCount > 0 ? 'warning' : 'info',
    source: 'seo',
    eventType: 'seo_specialist_run',
    message:
      `Cron do SEO executado: ${auditsRun} auditoria(s), ${contentGenerated} conteúdo(s) gerado(s), ` +
      `${rankingsChecked} posição(ões) checada(s), ${gscSnapshotsFetched} desempenho(s) real(is) do Search Console, ${errorsCount} erro(s).`,
    metadata: { results },
  })

  return NextResponse.json({ ok: true, auditsRun, contentGenerated, rankingsChecked, gscSnapshotsFetched, errors: errorsCount })
}
