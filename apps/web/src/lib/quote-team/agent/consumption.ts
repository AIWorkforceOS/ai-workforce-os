import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchOpenAIRealCost } from '@/lib/openai-costs'
import { getOpenAIApiKey } from '@/lib/openai'

export const OPENAI_BILLING_URL = 'https://platform.openai.com/settings/organization/billing/overview'

type Row = Record<string, unknown>
const num = (v: unknown) => Number(v ?? 0)

export type AgentUsageRow = { endpoint: string; requests: number; tokens: number; estimated_usd: number }

/** Agrupa os eventos de uso estimado por agente/etapa (`quote-agent:diagnosis`, `receptionist`…). */
export function groupUsageByEndpoint(rows: Row[]): AgentUsageRow[] {
  const map = new Map<string, AgentUsageRow>()
  for (const r of rows) {
    const key = String(r.endpoint ?? 'desconhecido')
    const cur = map.get(key) ?? { endpoint: key, requests: 0, tokens: 0, estimated_usd: 0 }
    cur.requests += num(r.request_count) || 1
    cur.tokens += num(r.total_tokens)
    cur.estimated_usd += num(r.estimated_cost_usd)
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => b.estimated_usd - a.estimated_usd)
}

export type BalanceView =
  | { kind: 'unavailable'; reason: string; billing_url: string }
  /** ESTIMATIVA, não saldo oficial: crédito carregado (informado manualmente) − custo real medido desde então. */
  | { kind: 'estimate'; loaded_usd: number; loaded_at: string; spent_since_usd: number; remaining_usd: number; low: boolean; low_threshold_usd: number; billing_url: string }

/**
 * Saldo da OpenAI: a OpenAI NÃO oferece API oficial para o saldo pré-pago. Então: ou "Saldo indisponível" (com link oficial), ou uma
 * ESTIMATIVA claramente rotulada quando o Vinicius informa o crédito carregado (OPENAI_PREPAID_LOADED_USD + OPENAI_PREPAID_LOADED_AT) e há
 * Admin API key para medir o custo real desde então. Nunca se inventa um saldo.
 */
export async function buildBalanceView(env: Record<string, string | undefined> = process.env, fetchCost = fetchOpenAIRealCost): Promise<BalanceView> {
  const unavailable = (reason: string): BalanceView => ({ kind: 'unavailable', reason, billing_url: OPENAI_BILLING_URL })
  const loaded = Number(env.OPENAI_PREPAID_LOADED_USD)
  const at = env.OPENAI_PREPAID_LOADED_AT ? new Date(env.OPENAI_PREPAID_LOADED_AT) : null
  if (!env.OPENAI_ADMIN_KEY) return unavailable('Saldo indisponível: a OpenAI não oferece API oficial de saldo pré-pago e a chave administrativa (OPENAI_ADMIN_KEY) não está configurada.')
  if (!Number.isFinite(loaded) || loaded <= 0 || !at || Number.isNaN(at.getTime())) return unavailable('Saldo indisponível: a OpenAI não oferece API oficial de saldo pré-pago. Informe o crédito carregado e a data (OPENAI_PREPAID_LOADED_USD / OPENAI_PREPAID_LOADED_AT) para ver uma estimativa.')
  const cost = await fetchCost({ from: at })
  if (!cost) return unavailable('Saldo indisponível: não foi possível ler o custo real na OpenAI agora.')
  const threshold = Number(env.OPENAI_LOW_CREDIT_USD ?? 20)
  const remaining = loaded - cost.amountUsd
  return { kind: 'estimate', loaded_usd: loaded, loaded_at: at.toISOString(), spent_since_usd: cost.amountUsd, remaining_usd: remaining, low: remaining < threshold, low_threshold_usd: threshold, billing_url: OPENAI_BILLING_URL }
}

export async function buildConsumptionView(db: SupabaseClient, unit: { id: string; org_id: string }, now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [eventsRes, lastRes, realCost, balance] = await Promise.all([
    db.from('api_usage_events').select('endpoint, request_count, total_tokens, estimated_cost_usd').eq('provider', 'openai').eq('org_id', unit.org_id).gte('created_at', monthStart.toISOString()).limit(20000),
    db.from('api_usage_events').select('created_at').eq('provider', 'openai').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    fetchOpenAIRealCost({ from: monthStart }),
    buildBalanceView(),
  ])
  const byAgent = groupUsageByEndpoint((eventsRes.data as Row[] | null) ?? [])
  return {
    updated_at: now.toISOString(),
    integration: { api_key_configured: Boolean(getOpenAIApiKey()), admin_key_configured: Boolean(process.env.OPENAI_ADMIN_KEY), last_usage_at: ((lastRes.data as Row | null)?.created_at as string | null) ?? null },
    balance,
    month: { real_cost_usd: realCost?.amountUsd ?? null, estimated_usd: byAgent.reduce((n, a) => n + a.estimated_usd, 0), by_agent: byAgent },
  }
}
