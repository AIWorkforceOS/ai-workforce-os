import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'
import { connectInstance, getEvolutionConfig } from '@/lib/evolution'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'whatsapp:manage'); if (!isPartnerContext(ctx)) return ctx
  const { id } = await params; const unit = await resolvePartnerUnit(ctx, { unitId: id }); if (!unit) return partnerError(404, 'Unidade não encontrada.')
  if (unit.whatsapp_connection_mode === 'official') return partnerError(409, 'Esta unidade usa a API oficial da Meta; o pareamento não utiliza QR Code.')
  const config = getEvolutionConfig(unit); if (!config) return partnerError(503, 'WhatsApp Evolution não está configurado no Alizo.')
  if (!unit.evolution_instance_name) await ctx.supabase.from('units').update({ evolution_instance_name: config.instanceName }).eq('id', unit.id)
  try { const data = await connectInstance(config, { supabase: ctx.supabase, orgId: unit.org_id, unitId: unit.id }); const qr = data?.base64 ?? data?.qrcode?.base64 ?? null; return NextResponse.json({ status: qr ? 'qr_pending' : 'connected', qr_code: qr, pairing_code: data?.pairingCode ?? data?.qrcode?.pairingCode ?? null, expires_at: qr ? new Date(Date.now() + 60_000).toISOString() : null, provider: 'evolution' }) }
  catch (error) { return partnerError(502, error instanceof Error ? error.message : 'Erro ao conectar o WhatsApp.') }
}
