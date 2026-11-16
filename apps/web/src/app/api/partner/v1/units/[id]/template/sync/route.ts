import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'
import { provisionPartnerUnit } from '@/lib/partner-api/unit-provisioning'
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { const ctx = await authenticatePartner(request, 'template:manage'); if (!isPartnerContext(ctx)) return ctx; const { id } = await params; const unit = await resolvePartnerUnit(ctx, { unitId: id }); if (!unit) return partnerError(404, 'Unidade não encontrada.'); const version = await provisionPartnerUnit(ctx.supabase, { orgId: ctx.orgId, unitId: unit.id }); return NextResponse.json({ ok: true, unit_id: unit.id, template_version: version }) }
