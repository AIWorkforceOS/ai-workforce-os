import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'

export async function POST(request: Request) {
  const ctx = await authenticatePartner(request, 'leads:write'); if (!isPartnerContext(ctx)) return ctx
  const body = await request.json().catch(() => null); const destination = typeof body?.destination === 'string' ? body.destination.trim().toLowerCase().slice(0, 250) : ''
  const channel = ['whatsapp','email','sms','all'].includes(body?.channel) ? body.channel : 'all'; if (!destination) return partnerError(400, 'destination é obrigatório.')
  let unitId: string | null = null; if (body?.unit_id) { const unit = await resolvePartnerUnit(ctx, { unitId: body.unit_id }); if (!unit) return partnerError(404, 'Unidade não encontrada.'); unitId = unit.id }
  const { data, error } = await ctx.supabase.from('partner_optouts').upsert({ org_id: ctx.orgId, unit_id: unitId, channel, destination, reason: typeof body.reason === 'string' ? body.reason.slice(0, 500) : null }, { onConflict: 'org_id,channel,destination' }).select('*').single()
  if (error) return partnerError(500, 'Não foi possível registrar o descadastro.'); return NextResponse.json({ ok: true, optout: data }, { status: 201 })
}
export async function GET(request: Request) {
  const ctx = await authenticatePartner(request, 'leads:read'); if (!isPartnerContext(ctx)) return ctx
  const s = new URL(request.url).searchParams; let q = ctx.supabase.from('partner_optouts').select('id, unit_id, channel, destination, reason, created_at').eq('org_id', ctx.orgId)
  if (s.get('destination')) q = q.eq('destination', s.get('destination')!.toLowerCase()); const { data } = await q.order('created_at', { ascending: false }).limit(200)
  return NextResponse.json({ optouts: data ?? [] })
}
