import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'
import { serializeLead } from '@/lib/partner-api/serialize'
import type { Lead } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** GET /api/partner/v1/leads/{id} (escopo leads:read) */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'leads:read')
  if (!isPartnerContext(ctx)) return ctx

  const { id } = await params
  const { data } = await ctx.supabase.from('leads').select('*').eq('id', id).maybeSingle()
  const lead = data as Lead | null
  if (!lead) return partnerError(404, 'Lead não encontrado.')

  // Isolamento: o lead só é visível se a unidade dele for da org (e da unidade da chave).
  const unit = await resolvePartnerUnit(ctx, { unitId: lead.unit_id })
  if (!unit) return partnerError(404, 'Lead não encontrado.')

  return NextResponse.json({ lead: serializeLead(lead) })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'leads:write'); if (!isPartnerContext(ctx)) return ctx
  const { id } = await params
  const { data: current } = await ctx.supabase.from('leads').select('*').eq('id', id).maybeSingle()
  const lead = current as Lead | null; if (!lead || !(await resolvePartnerUnit(ctx, { unitId: lead.unit_id }))) return partnerError(404, 'Lead não encontrado.')
  const body = await request.json().catch(() => null); if (!body || typeof body !== 'object') return partnerError(400, 'Payload inválido.')
  const updates: Record<string, unknown> = {}
  if (body.status !== undefined) {
    const allowed = ['new','contacted','replied','negotiating','won','lost','paused']
    if (!allowed.includes(body.status)) return partnerError(400, 'status inválido.')
    updates.status = body.status
  }
  if (body.notes !== undefined) updates.notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 4000) || null : null
  if (body.owner !== undefined) updates.owner_user_id = typeof body.owner === 'string' && body.owner ? body.owner : null
  const { data, error } = await ctx.supabase.from('leads').update(updates).eq('id', id).select('*').single()
  if (error || !data) return partnerError(500, 'Não foi possível atualizar o lead.')
  return NextResponse.json({ ok: true, lead: serializeLead(data as Lead) })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'leads:write'); if (!isPartnerContext(ctx)) return ctx
  const { id } = await params; const { data } = await ctx.supabase.from('leads').select('id, unit_id').eq('id', id).maybeSingle()
  const row = data as { id: string; unit_id: string } | null; if (!row || !(await resolvePartnerUnit(ctx, { unitId: row.unit_id }))) return partnerError(404, 'Lead não encontrado.')
  const { error } = await ctx.supabase.from('leads').delete().eq('id', id); if (error) return partnerError(500, 'Não foi possível excluir os dados do lead.')
  return NextResponse.json({ ok: true, deleted: true })
}
