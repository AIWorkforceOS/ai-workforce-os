import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'
import { ensureWebhookConfigured, getInstanceStatus, legacyWhatsappChannel, syncWhatsappPhoneIfConnected } from '@/lib/evolution'
import { emitPartnerEvent } from '@/lib/partner-api/webhooks'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'whatsapp:manage'); if (!isPartnerContext(ctx)) return ctx
  const { id } = await params; const unit = await resolvePartnerUnit(ctx, { unitId: id }); if (!unit) return partnerError(404, 'Unidade não encontrada.')
  const channel = legacyWhatsappChannel(ctx.supabase, unit)
  if (!channel) return NextResponse.json({ status: 'disconnected', provider: unit.whatsapp_connection_mode === 'official' ? 'meta' : 'evolution', phone: unit.whatsapp_phone, last_activity_at: null })
  try {
    const raw = await getInstanceStatus(channel.config)
    if (raw === 'open') { await syncWhatsappPhoneIfConnected(ctx.supabase, unit, channel); await ensureWebhookConfigured(channel.config, { supabase: ctx.supabase, orgId: unit.org_id, unitId: unit.id }) }
    const status = raw === 'open' ? 'connected' : raw === 'connecting' ? 'qr_pending' : 'disconnected'
    const previous = (unit as typeof unit & { partner_whatsapp_status?: string | null }).partner_whatsapp_status ?? null
    if (previous !== status) {
      await ctx.supabase.from('units').update({ partner_whatsapp_status: status }).eq('id', unit.id)
      if (status === 'connected' || status === 'disconnected') await emitPartnerEvent(ctx.supabase, { orgId: unit.org_id, unitId: unit.id, type: status === 'connected' ? 'unit.whatsapp.connected' : 'unit.whatsapp.disconnected', data: { status, phone: unit.whatsapp_phone, provider: 'evolution' } })
    }
    const { data: activity } = await ctx.supabase.from('conversations').select('sent_at').eq('unit_id', unit.id).order('sent_at', { ascending: false }).limit(1).maybeSingle()
    return NextResponse.json({ status, provider: 'evolution', phone: unit.whatsapp_phone, last_activity_at: (activity as { sent_at?: string } | null)?.sent_at ?? null })
  } catch (error) { return NextResponse.json({ status: 'error', provider: 'evolution', phone: unit.whatsapp_phone, error: error instanceof Error ? error.message : 'Erro desconhecido.' }, { status: 502 }) }
}
