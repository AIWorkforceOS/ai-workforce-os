import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError } from '@/lib/partner-api/auth'
import { provisionPartnerUnit } from '@/lib/partner-api/unit-provisioning'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'units:write'); if (!isPartnerContext(ctx)) return ctx
  const { id } = await params
  let q = ctx.supabase.from('units').update({ is_active: true, deactivated_reason: null }).eq('id', id).eq('org_id', ctx.orgId)
  if (ctx.unitId) q = q.eq('id', ctx.unitId)
  const { data } = await q.select('id').maybeSingle(); if (!data) return partnerError(404, 'Unidade não encontrada.')
  const templateVersion = await provisionPartnerUnit(ctx.supabase, { orgId: ctx.orgId, unitId: id })
  return NextResponse.json({ ok: true, status: 'active', template_version: templateVersion })
}
