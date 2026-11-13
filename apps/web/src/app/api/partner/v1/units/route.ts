import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, listPartnerUnitIds } from '@/lib/partner-api/auth'
import { serializeUnit } from '@/lib/partner-api/serialize'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** GET /api/partner/v1/units — unidades que a chave enxerga (escopo units:read). */
export async function GET(request: Request) {
  const ctx = await authenticatePartner(request, 'units:read')
  if (!isPartnerContext(ctx)) return ctx

  const ids = await listPartnerUnitIds(ctx)
  if (ids.length === 0) return NextResponse.json({ units: [] })

  const { data } = await ctx.supabase.from('units').select('*').in('id', ids).order('created_at', { ascending: true })
  const units = ((data as Unit[] | null) ?? []).filter((u) => u.is_active !== false)
  return NextResponse.json({ units: units.map(serializeUnit) })
}
