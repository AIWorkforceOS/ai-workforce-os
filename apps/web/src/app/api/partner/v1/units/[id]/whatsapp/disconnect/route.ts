import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'
import { disconnectInstance, legacyWhatsappChannel } from '@/lib/evolution'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'whatsapp:manage'); if (!isPartnerContext(ctx)) return ctx
  const { id } = await params; const unit = await resolvePartnerUnit(ctx, { unitId: id }); if (!unit) return partnerError(404, 'Unidade não encontrada.')
  const channel = legacyWhatsappChannel(ctx.supabase, unit); if (!channel) return NextResponse.json({ ok: true, status: 'disconnected' })
  try { await disconnectInstance(channel.config); await ctx.supabase.from('units').update({ whatsapp_phone: null }).eq('id', unit.id); return NextResponse.json({ ok: true, status: 'disconnected' }) }
  catch (error) { return partnerError(502, error instanceof Error ? error.message : 'Erro ao desconectar o WhatsApp.') }
}
