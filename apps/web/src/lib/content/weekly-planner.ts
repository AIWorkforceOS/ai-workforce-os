// Planejamento semanal do Gestor de Conteúdo (pedido do Vinicius,
// 2026-08-23): gera um post por dia selecionado
// (agent_configs.business_profile.dias_publicacao, ver planner.ts), cada
// um já com o dia certo em scheduled_for. Nunca publica na hora, mesmo em
// modo autônomo — só marca 'approved' (autônomo) ou 'pending_approval'
// (fila) e quem publica de fato na data certa é publishDueScheduledPosts,
// chamada todo dia pelo cron (api/cron/content/route.ts). Reaproveita a
// mesma geração e as mesmas regras de plataforma/pilar/idioma/marca do
// fluxo diário avulso — só muda O QUE fica gravado (scheduled_for) e
// QUANDO publica.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { contentPillarsFrom, contentPlatformsFrom, decidePublishAction, pickNextPillar, pickNextPlatform } from './planner'
import { generatePostContent, generatePostImage, uploadGeneratedImage } from './generator'
import { holidayOnDate } from './holidays'
import type { ContentPost, SocialAccount, SocialPlatform } from './types'
import type { AgentConfig, Unit } from '@/lib/types'

export type WeekPlanResult = {
  created: number
  skipped: number
  errors: { date: string; error: string }[]
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Gera o planejamento semanal (uma tentativa por data em `dates`) pra UMA conta social. */
export async function generateWeekPostsForAccount(params: {
  supabase: SupabaseClient
  apiKey: string
  config: AgentConfig
  unit: Unit
  account: SocialAccount
  dates: Date[]
}): Promise<WeekPlanResult> {
  const { supabase, apiKey, config, unit, account, dates } = params
  const result: WeekPlanResult = { created: 0, skipped: 0, errors: [] }
  if (dates.length === 0) return result

  const desiredPlatforms = contentPlatformsFrom(config.business_profile ?? {})
  const supportedPlatforms: SocialPlatform[] = account.instagram_business_account_id
    ? desiredPlatforms
    : desiredPlatforms.filter((p) => p !== 'instagram')
  if (supportedPlatforms.length === 0) {
    result.errors.push({ date: '-', error: 'Nenhuma plataforma disponível para esta conta (Instagram não vinculado).' })
    return result
  }

  const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unit.org_id)
  const pillars = contentPillarsFrom(config.business_profile ?? {})

  const rangeStart = dates.reduce((min, d) => (d < min ? d : min), dates[0]!)
  const historyStart = new Date(rangeStart.getTime() - 7 * 24 * 60 * 60 * 1000)
  const { data: existing } = await supabase
    .from('content_posts')
    .select('platform, content_pillar, status, created_at, scheduled_for')
    .eq('social_account_id', account.id)
    .gte('created_at', historyStart.toISOString())
    .order('created_at', { ascending: false })
    .limit(100)
  const history = (existing ?? []) as Pick<ContentPost, 'platform' | 'content_pillar' | 'status' | 'created_at' | 'scheduled_for'>[]

  const alreadyScheduled = new Set(history.filter((p) => p.scheduled_for).map((p) => dateKey(new Date(p.scheduled_for!))))

  // Acumula o histórico + o que já foi gerado dentro deste mesmo lote, pra
  // pickNextPlatform/pickNextPillar continuarem alternando corretamente ao
  // longo da semana toda, não só olhando pro que já existia antes.
  const runningHistory: Pick<ContentPost, 'platform' | 'content_pillar' | 'created_at'>[] = history.map((p) => ({
    platform: p.platform,
    content_pillar: p.content_pillar,
    created_at: p.created_at,
  }))

  const logoUrl = (organizationProfile as { brand_kit?: { logo_url?: string | null } } | null)?.brand_kit?.logo_url ?? null

  for (const date of dates) {
    const key = dateKey(date)
    if (alreadyScheduled.has(key)) {
      result.skipped += 1
      continue
    }

    const platform = pickNextPlatform(supportedPlatforms, runningHistory)
    const pillar = pickNextPillar(pillars, runningHistory)
    const holiday = holidayOnDate(date)

    try {
      const content = await generatePostContent({
        apiKey,
        config,
        unit,
        organizationProfile,
        platform,
        pillar,
        holiday: holiday?.name ?? null,
      })
      const image = await generatePostImage({ apiKey, imagePrompt: content.imagePrompt, logoUrl })
      const imageUrl = await uploadGeneratedImage({ supabase, unitId: unit.id, base64Image: image.base64Image })

      const action = decidePublishAction(account.publishing_mode)
      const scheduledFor = new Date(date)
      scheduledFor.setUTCHours(12, 0, 0, 0) // hora fixa neutra — o que importa é o dia

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
          scheduled_for: scheduledFor.toISOString(),
        })
        .select('*')
        .single()

      if (insertError || !inserted) throw new Error(insertError?.message ?? 'Falha ao gravar o post gerado.')

      result.created += 1
      runningHistory.push({ platform, content_pillar: pillar, created_at: new Date().toISOString() })
    } catch (error) {
      result.errors.push({ date: key, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return result
}
