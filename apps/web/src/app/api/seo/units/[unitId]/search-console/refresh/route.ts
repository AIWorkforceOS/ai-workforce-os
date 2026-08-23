import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchSearchConsolePerformance } from '@/lib/seo/search-console'
import { getGoogleSearchConsoleCredentials, refreshAccessToken } from '@/lib/seo/search-console-oauth'
import type { SeoSearchConsoleAccount } from '@/lib/seo/types'

export const maxDuration = 60

/**
 * Busca o desempenho real do Search Console agora (fora do ciclo semanal
 * do cron) — botão "Atualizar agora" no painel, mesmo raciocínio de
 * api/seo/units/[unitId]/audits/run: sem isso, testar a conexão exigiria
 * esperar o próximo ciclo do cron (até 1 dia) pra ver o primeiro dado real.
 *
 * Permissão: o select em `units` abaixo só encontra a unidade se a sessão
 * puder vê-la (RLS); a escrita em seo_search_console_snapshots é
 * restrita ao motor (service role, ver migration 072).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { data: visibleUnit } = await supabase.from('units').select('id').eq('id', unitId).maybeSingle()
  if (!visibleUnit) return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })

  const credentials = getGoogleSearchConsoleCredentials()
  if (!credentials) {
    return NextResponse.json({ error: 'Conexão com o Search Console não configurada — configure as credenciais do Google primeiro.' }, { status: 500 })
  }

  const { data: accountRow } = await service.from('seo_search_console_accounts').select('*').eq('unit_id', unitId).maybeSingle()
  const account = accountRow as SeoSearchConsoleAccount | null
  if (!account) return NextResponse.json({ error: 'Nenhuma conta do Search Console conectada nesta unidade ainda.' }, { status: 404 })

  try {
    const { accessToken } = await refreshAccessToken({
      refreshToken: account.refresh_token,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    })

    const performance = await fetchSearchConsolePerformance({ siteUrl: account.site_url, accessToken })

    const { data: snapshot, error: insertError } = await service
      .from('seo_search_console_snapshots')
      .insert({
        org_id: account.org_id,
        unit_id: unitId,
        period_start: performance.periodStart,
        period_end: performance.periodEnd,
        total_clicks: performance.totalClicks,
        total_impressions: performance.totalImpressions,
        avg_ctr: performance.avgCtr,
        avg_position: performance.avgPosition,
        top_queries: performance.topQueries,
      })
      .select('*')
      .single()
    if (insertError) throw new Error(insertError.message)

    await service
      .from('seo_search_console_accounts')
      .update({ access_token: accessToken, connection_status: 'connected', connection_error: null })
      .eq('id', account.id)

    return NextResponse.json({ snapshot })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await service.from('seo_search_console_accounts').update({ connection_status: 'error', connection_error: message }).eq('id', account.id)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
