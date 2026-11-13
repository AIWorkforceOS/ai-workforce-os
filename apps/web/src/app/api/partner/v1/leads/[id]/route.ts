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
