import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'
import { forceReconnectInstance, getEvolutionConfig } from '@/lib/evolution'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'whatsapp:manage'); if (!isPartnerContext(ctx)) return ctx
  const { id } = await params; const unit = await resolvePartnerUnit(ctx, { unitId: id }); if (!unit) return partnerError(404, 'Unidade não encontrada.')
  const config = getEvolutionConfig(unit); if (!config) return partnerError(503, 'WhatsApp Evolution não está configurado no Alizo.')
  try { const data = await forceReconnectInstance(config, { supabase: ctx.supabase, orgId: unit.org_id, unitId: unit.id }); const qr = data?.base64 ?? data?.qrcode?.base64 ?? null; return NextResponse.json({ status: qr ? 'qr_pending' : 'connected', qr_code: qr, pairing_code: data?.pairingCode ?? data?.qrcode?.pairingCode ?? null, expires_at: qr ? new Date(Date.now() + 60_000).toISOString() : null, provider: 'evolution' }) }
  catch (error) { return partnerError(502, error instanceof Error ? error.message : 'Erro ao reconectar o WhatsApp.') }
}
