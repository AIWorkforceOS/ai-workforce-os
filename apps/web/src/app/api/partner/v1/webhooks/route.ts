import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError } from '@/lib/partner-api/auth'
import {
  PARTNER_EVENT_TYPES,
  generateWebhookSecret,
  validateWebhookUrl,
} from '@/lib/partner-api/webhooks'

export const dynamic = 'force-dynamic'

const MAX_ENDPOINTS_PER_KEY = 5

type EndpointRow = { id: string; url: string; events: string[]; is_active: boolean; created_at: string }

/** GET /api/partner/v1/webhooks (escopo webhooks:manage) — endpoints desta chave (sem o secret). */
export async function GET(request: Request) {
  const ctx = await authenticatePartner(request, 'webhooks:manage')
  if (!isPartnerContext(ctx)) return ctx

  const { data } = await ctx.supabase
    .from('partner_webhook_endpoints')
    .select('id, url, events, is_active, created_at')
    .eq('api_key_id', ctx.keyId)
    .order('created_at', { ascending: true })

  return NextResponse.json({
    webhooks: ((data as EndpointRow[] | null) ?? []).map((w) => ({
      id: w.id,
      url: w.url,
      events: w.events,
      is_active: w.is_active,
      created_at: w.created_at,
    })),
    available_events: PARTNER_EVENT_TYPES,
  })
}

/**
 * POST /api/partner/v1/webhooks (escopo webhooks:manage)
 * Body: { url (https), events?: string[] (padrão ["*"]) }
 * O `secret` é devolvido UMA ÚNICA vez — guarde-o para validar Alizo-Signature.
 */
export async function POST(request: Request) {
  const ctx = await authenticatePartner(request, 'webhooks:manage')
  if (!isPartnerContext(ctx)) return ctx

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return partnerError(400, 'Payload inválido.')

  const url = validateWebhookUrl(body.url)
  if (!url.ok) return partnerError(400, url.error)

  let events: string[] = ['*']
  if (body.events !== undefined) {
    if (!Array.isArray(body.events) || body.events.length === 0) {
      return partnerError(400, 'events deve ser uma lista não vazia.')
    }
    const invalid = body.events.filter(
      (e: unknown) => e !== '*' && !(PARTNER_EVENT_TYPES as readonly string[]).includes(String(e)),
    )
    if (invalid.length > 0) return partnerError(400, `Eventos desconhecidos: ${invalid.join(', ')}.`)
    events = body.events.map(String)
  }

  const { count } = await ctx.supabase
    .from('partner_webhook_endpoints')
    .select('id', { count: 'exact', head: true })
    .eq('api_key_id', ctx.keyId)
  if ((count ?? 0) >= MAX_ENDPOINTS_PER_KEY) {
    return partnerError(409, `Limite de ${MAX_ENDPOINTS_PER_KEY} webhooks por chave atingido.`)
  }

  const secret = generateWebhookSecret()
  const { data, error } = await ctx.supabase
    .from('partner_webhook_endpoints')
    .insert({ org_id: ctx.orgId, api_key_id: ctx.keyId, url: url.url, secret, events })
    .select('id, url, events, is_active, created_at')
    .single()

  if (error || !data) return partnerError(500, 'Não foi possível criar o webhook.')
  const created = data as EndpointRow
  const webhook = { id: created.id, url: created.url, events: created.events, is_active: created.is_active, created_at: created.created_at }
  return NextResponse.json({ ok: true, webhook, secret }, { status: 201 })
}
