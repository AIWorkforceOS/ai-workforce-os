import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sendTechnicalAlertEmail } from '@/lib/email'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const PROVIDERS = [
  { key: 'openai', label: 'OpenAI', budgetEnv: 'OPENAI_MONTHLY_BUDGET_USD' },
  { key: 'google_maps', label: 'Google Maps', budgetEnv: 'GOOGLE_MAPS_MONTHLY_BUDGET_USD' },
] as const

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 503 })
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const monthKey = monthStart.slice(0, 7)
  const email = process.env.SUPPORT_ALERT_EMAIL || 'suporte@alizo.com.br'
  const alerts: string[] = []

  for (const provider of PROVIDERS) {
    const budget = Number(process.env[provider.budgetEnv] ?? 0)
    if (!Number.isFinite(budget) || budget <= 0) continue

    const { data } = await supabase
      .from('api_usage_events')
      .select('estimated_cost_usd')
      .eq('provider', provider.key)
      .gte('created_at', monthStart)
      .limit(50000)
    const spent = ((data ?? []) as { estimated_cost_usd: number | null }[]).reduce((sum, row) => sum + Number(row.estimated_cost_usd ?? 0), 0)
    if (spent < budget * 0.8) continue

    const eventType = `provider_budget_80_${provider.key}_${monthKey}`
    const { data: existing } = await supabase.from('system_events').select('id').eq('event_type', eventType).maybeSingle()
    if (existing) continue

    const percentage = Math.round((spent / budget) * 100)
    await sendTechnicalAlertEmail({
      to: email,
      unitName: 'Alizo Admin Master',
      problem: `${provider.label} atingiu ${percentage}% do limite mensal configurado.`,
      impact: `Uso estimado: US$ ${spent.toFixed(2)} de US$ ${budget.toFixed(2)}. Revise faturamento e créditos no painel do fornecedor para evitar interrupção.`,
    })
    await supabase.from('system_events').insert({
      level: 'warning',
      source: provider.key,
      event_type: eventType,
      message: `${provider.label}: ${percentage}% do limite mensal estimado.`,
      metadata: { spent_usd: spent, budget_usd: budget, month: monthKey },
    })
    alerts.push(provider.key)
  }

  return NextResponse.json({ ok: true, alerts })
}
