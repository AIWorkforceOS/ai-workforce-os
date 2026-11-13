import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext } from '@/lib/partner-api/auth'
import { parseLimit } from '@/lib/partner-api/serialize'

export const dynamic = 'force-dynamic'

type EventRow = { id: string; type: string; unit_id: string | null; data: unknown; created_at: string }

/**
 * GET /api/partner/v1/events (escopo events:read) — alternativa por polling
 * aos webhooks (e forma de recuperar entregas perdidas).
 * Query: since? (ISO, inclusivo), before? (ISO, paginação), type?, limit? (<=100)
 * Ordem: mais recentes primeiro. Chave restrita a uma unidade só vê eventos dela.
 */
export async function GET(request: Request) {
  const ctx = await authenticatePartner(request, 'events:read')
  if (!isPartnerContext(ctx)) return ctx

  const search = new URL(request.url).searchParams
  const limit = parseLimit(search.get('limit'))

  let query = ctx.supabase
    .from('partner_events')
    .select('id, type, unit_id, data, created_at')
    .eq('org_id', ctx.orgId)
  if (ctx.unitId) query = query.eq('unit_id', ctx.unitId)
  const type = search.get('type')
  if (type) query = query.eq('type', type)
  const since = search.get('since')
  if (since) query = query.gte('created_at', since)
  const before = search.get('before')
  if (before) query = query.lt('created_at', before)

  const { data } = await query.order('created_at', { ascending: false }).limit(limit)
  const events = (data as EventRow[] | null) ?? []
  return NextResponse.json({
    events,
    next_before: events.length === limit ? events[events.length - 1]!.created_at : null,
  })
}
