import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'leads:write'); if (!isPartnerContext(ctx)) return ctx
  const { id } = await params; const { data } = await ctx.supabase.from('leads').select('unit_id').eq('id', id).maybeSingle()
  if (!data || !(await resolvePartnerUnit(ctx, { unitId: (data as { unit_id: string }).unit_id }))) return partnerError(404, 'Lead não encontrado.')
  await ctx.supabase.from('leads').update({ status: 'paused' }).eq('id', id); return NextResponse.json({ ok: true, status: 'paused' })
}
