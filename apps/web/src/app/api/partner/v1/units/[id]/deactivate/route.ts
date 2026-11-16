import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError } from '@/lib/partner-api/auth'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'units:write'); if (!isPartnerContext(ctx)) return ctx
  const { id } = await params; const body = await request.json().catch(() => ({}))
  let q = ctx.supabase.from('units').update({ is_active: false, deactivated_reason: typeof body?.reason === 'string' ? body.reason.slice(0, 500) : null }).eq('id', id).eq('org_id', ctx.orgId)
  if (ctx.unitId) q = q.eq('id', ctx.unitId)
  const { data } = await q.select('id').maybeSingle(); if (!data) return partnerError(404, 'Unidade não encontrada.')
  await ctx.supabase.from('agent_configs').update({ is_active: false }).eq('unit_id', id)
  return NextResponse.json({ ok: true, status: 'deactivated' })
}
