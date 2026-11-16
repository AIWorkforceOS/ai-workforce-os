import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'leads:write'); if (!isPartnerContext(ctx)) return ctx
  const { id } = await params; const { data } = await ctx.supabase.from('leads').select('unit_id, last_contacted_at').eq('id', id).maybeSingle()
  const row = data as { unit_id: string; last_contacted_at: string | null } | null; if (!row || !(await resolvePartnerUnit(ctx, { unitId: row.unit_id }))) return partnerError(404, 'Lead não encontrado.')
  const status = row.last_contacted_at ? 'contacted' : 'new'; await ctx.supabase.from('leads').update({ status }).eq('id', id); return NextResponse.json({ ok: true, status })
}
