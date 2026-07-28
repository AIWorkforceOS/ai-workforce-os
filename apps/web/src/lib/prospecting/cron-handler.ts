import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getGoogleMapsApiKey } from '@/lib/google-places'
import { isWithinActiveHours } from '@/lib/conversation-engine'
import { runProspectingForUnit } from '@/lib/prospecting/engine'
import { logSystemEvent } from '@/lib/system-events'
import type { AgentConfig, Unit } from '@/lib/types'

/**
 * Prospecção autônoma do Sales Rep — handler compartilhado pelas rotas
 * /api/cron/prospecting{,-midday,-afternoon}.
 *
 * FREQUÊNCIA (limite do plano Vercel): o plano Hobby do Vercel só aceita
 * cron com cadência de no máximo 1x/dia por job — expressões tipo
 * "a cada 3 horas" fazem o deploy FALHAR nesse plano. Para o Sales Rep
 * "trabalhar o dia todo" mesmo assim, registramos TRÊS cron jobs diários
 * (manhã/meio-dia/tarde, ver vercel.json) apontando para este mesmo
 * handler. Se o projeto estiver (ou migrar para) o plano Pro, dá para
 * trocar por um único job com schedule mais frequente (ex. "0 * * * *").
 *
 * A cada rodada o perfil de segmentação é relido do banco
 * (agent_configs.prospecting_profile) — mudou a config, a rodada
 * seguinte já trabalha em cima da config nova, nunca de uma cópia
 * congelada.
 */
export async function handleProspectingCron(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') ?? ''

  if (!cronSecret) {
    console.error('[cron/prospecting] CRON_SECRET não configurado — cron desabilitado.')
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    console.error('[cron/prospecting] SUPABASE_SERVICE_ROLE_KEY não configurada.')
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const apiKey = getGoogleMapsApiKey()
  if (!apiKey) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'google_maps',
      eventType: 'prospecting_missing_google_maps',
      message: 'Cron de prospecção abortado: GOOGLE_MAPS_API_KEY não está configurada.',
    })
    return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY não configurada.' }, { status: 500 })
  }

  // Folga de 10s antes do maxDuration da função: o que não couber nesta
  // rodada é retomado na próxima rodada do dia.
  const deadline = Date.now() + 50_000

  const { data: configs } = await supabase
    .from('agent_configs')
    .select('*, units(*)')
    .eq('agent_type', 'sdr')
    .eq('is_active', true)

  type ConfigWithUnit = AgentConfig & { units: Unit | null }
  const configRows = ((configs ?? []) as ConfigWithUnit[]).filter(
    (row) => row.units && row.units.is_active,
  )

  let totalCaptured = 0
  let totalContacted = 0
  let totalSkipped = 0
  const results: Array<Record<string, unknown>> = []

  for (const config of configRows) {
    const unit = config.units as Unit
    if (Date.now() > deadline) break

    if (!isWithinActiveHours(config.active_hours)) {
      totalSkipped += 1
      results.push({ unit: unit.name, skipped: 'fora do horário ativo' })
      continue
    }

    const result = await runProspectingForUnit({ supabase, unit, config, apiKey, deadline })
    totalCaptured += result.captured
    totalContacted += result.contacted
    if (result.skipped) totalSkipped += 1
    results.push({ unit: unit.name, ...result })
  }

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'cron',
    eventType: 'prospecting_run',
    message: `Cron de prospecção executado: ${totalCaptured} leads capturados, ${totalContacted} primeiros contatos, ${totalSkipped} unidades puladas.`,
    metadata: { results },
  })

  return NextResponse.json({
    ok: true,
    captured: totalCaptured,
    contacted: totalContacted,
    skippedUnits: totalSkipped,
  })
}
