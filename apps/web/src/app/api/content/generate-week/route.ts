import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getOpenAIApiKey } from '@/lib/openai'
import { postingDaysFrom, resolveWeekPlanDates } from '@/lib/content/planner'
import { generateWeekPostsForAccount } from '@/lib/content/weekly-planner'
import type { SocialAccount } from '@/lib/content/types'
import type { AgentConfig, Unit } from '@/lib/types'

export const maxDuration = 280

/**
 * Botão "gerar planejamento semanal" (pedido do Vinicius, 2026-08-23): o
 * mesmo gatilho que roda sozinho toda sexta-feira (ver
 * lib/content/weekly-planner.ts + api/cron/content/route.ts), só que
 * disparado na hora pelo clique humano. Completa o que resta da semana
 * atual — ou já cai pra semana seguinte se não sobrar nenhum dia (ver
 * resolveWeekPlanDates), então funciona bem em qualquer dia da semana.
 *
 * POST { unit_id, social_account_id? }
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: { unit_id?: string; social_account_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  if (!body.unit_id) return NextResponse.json({ error: 'unit_id é obrigatório.' }, { status: 400 })

  const { data: unit } = await supabase.from('units').select('*').eq('id', body.unit_id).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada ou sem permissão.' }, { status: 404 })

  const { data: config } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('agent_type', 'content_specialist')
    .eq('is_active', true)
    .maybeSingle()
  if (!config) {
    return NextResponse.json({ error: 'O Gestor de Conteúdo ainda não está ativo nesta unidade — complete a contratação primeiro.' }, { status: 400 })
  }

  let accountQuery = supabase
    .from('social_accounts')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('is_active', true)
    .eq('connection_status', 'connected')
  if (body.social_account_id) accountQuery = accountQuery.eq('id', body.social_account_id)
  const { data: accounts } = await accountQuery
  const accountRows = (accounts ?? []) as SocialAccount[]
  if (accountRows.length === 0) {
    return NextResponse.json({ error: 'Nenhuma conta conectada encontrada — conecte o Instagram/Facebook primeiro.' }, { status: 404 })
  }

  const apiKey = getOpenAIApiKey()
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY não configurada.' }, { status: 500 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })

  const profile = (config as AgentConfig).business_profile ?? {}
  const dates = resolveWeekPlanDates(postingDaysFrom(profile), new Date())

  const results = []
  let totalCreated = 0
  let totalSkipped = 0
  const errors: { account: string; date: string; error: string }[] = []

  for (const account of accountRows) {
    const result = await generateWeekPostsForAccount({
      supabase: service,
      apiKey,
      config: config as AgentConfig,
      unit: unit as Unit,
      account,
      dates,
    })
    totalCreated += result.created
    totalSkipped += result.skipped
    for (const err of result.errors) errors.push({ account: account.page_name, date: err.date, error: err.error })
    results.push({ account: account.page_name, ...result })
  }

  return NextResponse.json({
    dates: dates.map((d) => d.toISOString().slice(0, 10)),
    created: totalCreated,
    skipped: totalSkipped,
    errors,
    results,
  })
}
