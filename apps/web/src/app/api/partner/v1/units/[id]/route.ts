import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'
import { serializeUnit } from '@/lib/partner-api/serialize'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'units:write')
  if (!isPartnerContext(ctx)) return ctx
  const { id } = await params
  const unit = await resolvePartnerUnit(ctx, { unitId: id })
  if (!unit) return partnerError(404, 'Unidade não encontrada.')
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return partnerError(400, 'Payload inválido.')
  const updates: Record<string, unknown> = {}
  const fields: Record<string, string> = { name: 'name', city: 'region_city', state: 'region_state', timezone: 'timezone', contact_email: 'contact_email', contact_phone: 'contact_phone', owner_name: 'owner_name', address: 'address', external_id: 'external_id' }
  for (const [input, column] of Object.entries(fields)) if (body[input] !== undefined) updates[column] = typeof body[input] === 'string' ? body[input].trim().slice(0, input === 'address' ? 500 : 200) || null : null
  const { data, error } = await ctx.supabase.from('units').update(updates).eq('id', unit.id).eq('org_id', ctx.orgId).select('*').single()
  if (error || !data) return partnerError(error?.code === '23505' ? 409 : 500, error?.code === '23505' ? 'external_id já está vinculado a outra unidade.' : 'Não foi possível atualizar a unidade.')
  return NextResponse.json({ ok: true, unit: serializeUnit(data as Unit) })
}
