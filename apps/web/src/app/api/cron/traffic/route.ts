import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logSystemEvent } from '@/lib/system-events'
import { syncAndOptimizeAccount } from '@/lib/traffic/sync'
import type { AdAccount } from '@/lib/traffic/types'
import type { AgentConfig, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Loop diário do Traffic Specialist (Vercel Cron, ver vercel.json).
 *
 * Para cada unidade com agente 'traffic_specialist' ativo, sincroniza as
 * contas de anúncio conectadas (Meta + Google), roda o motor de estratégia,
 * grava decisões com rationale e — apenas em contas com
 * optimization_mode='autonomous' — executa as ações direto na plataforma.
 * Contas em modo 'suggestion' (padrão) apenas acumulam recomendações para
 * aprovação humana no dashboard.
 *
 * Também expira sugestões antigas (expires_at vencido) para o painel não
 * acumular recomendação baseada em métrica velha.
 *
 * Env vars:
 *   CRON_SECRET       — obrigatório (Vercel envia como Bearer token)
 *   TRAFFIC_USE_MOCK  — '1' roda o pipeline com dados mockados (demo/validação)
 *   TRAFFIC_DRY_RUN   — '1' registra ações sem chamar as plataformas
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') ?? ''

  if (!cronSecret) {
    console.error('[cron/traffic] CRON_SECRET não configurado — cron desabilitado.')
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    console.error('[cron/traffic] SUPABASE_SERVICE_ROLE_KEY não configurada.')
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  // Expira sugestões vencidas antes de gerar novas
  await supabase
    .from('traffic_decisions')
    .update({ status: 'expired' })
    .eq('status', 'suggested')
    .lt('expires_at', new Date().toISOString())

  const { data: configs } = await supabase
    .from('agent_configs')
    .select('*, units(*)')
    .eq('agent_type', 'traffic_specialist')
    .eq('is_active', true)

  type ConfigWithUnit = AgentConfig & { units: Unit | null }
  const activeUnitIds = ((configs ?? []) as ConfigWithUnit[])
    .filter((row) => row.units && row.units.is_active)
    .map((row) => row.unit_id)

  if (activeUnitIds.length === 0) {
    return NextResponse.json({ ok: true, accounts: 0, message: 'Nenhum agente de tráfego ativo.' })
  }

  const { data: accounts } = await supabase
    .from('ad_accounts')
    .select('*')
    .in('unit_id', activeUnitIds)
    .eq('is_active', true)

  const accountRows = (accounts ?? []) as AdAccount[]

  let totalDecisions = 0
  let totalExecuted = 0
  let totalErrors = 0

  const results = []
  for (const account of accountRows) {
    const result = await syncAndOptimizeAccount(supabase, account)
    if (!result.ok) totalErrors += 1
    totalDecisions += result.decisionsCreated
    totalExecuted += result.decisionsExecuted
    results.push({ account: account.name, platform: account.platform, ...result })
  }

  await logSystemEvent(supabase, {
    level: totalErrors > 0 ? 'warning' : 'info',
    source: 'cron',
    eventType: 'traffic_optimizer_run',
    message:
      `Cron do Traffic Specialist executado: ${accountRows.length} conta(s), ` +
      `${totalDecisions} decisão(ões) criadas, ${totalExecuted} executadas, ${totalErrors} erro(s).`,
    metadata: { results },
  })

  return NextResponse.json({
    ok: true,
    accounts: accountRows.length,
    decisionsCreated: totalDecisions,
    decisionsExecuted: totalExecuted,
    errors: totalErrors,
  })
}
