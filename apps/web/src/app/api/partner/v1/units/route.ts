import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, listPartnerUnitIds, partnerError } from '@/lib/partner-api/auth'
import { serializeUnit } from '@/lib/partner-api/serialize'
import { provisionPartnerUnit, uniqueUnitSlug } from '@/lib/partner-api/unit-provisioning'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** GET /api/partner/v1/units — unidades que a chave enxerga (escopo units:read). */
export async function GET(request: Request) {
  const ctx = await authenticatePartner(request, 'units:read')
  if (!isPartnerContext(ctx)) return ctx

  const ids = await listPartnerUnitIds(ctx)
  if (ids.length === 0) return NextResponse.json({ units: [] })

  const externalId = new URL(request.url).searchParams.get('external_id')
  let query = ctx.supabase.from('units').select('*').in('id', ids)
  if (externalId) query = query.eq('external_id', externalId)
  const { data } = await query.order('created_at', { ascending: true })
  const units = (data as Unit[] | null) ?? []
  return NextResponse.json({ units: units.map(serializeUnit) })
}

/** POST /units — criação idempotente pelo external_id da franquia. */
export async function POST(request: Request) {
  const ctx = await authenticatePartner(request, 'units:write')
  if (!isPartnerContext(ctx)) return ctx
  if (ctx.unitId) return partnerError(403, 'Uma chave restrita a unidade não pode criar outras unidades.')
  const body = await request.json().catch(() => null)
  const externalId = typeof body?.external_id === 'string' ? body.external_id.trim().slice(0, 160) : ''
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 160) : ''
  if (!externalId || !name) return partnerError(400, 'external_id e name são obrigatórios.')
  const { data: existing } = await ctx.supabase.from('units').select('*').eq('org_id', ctx.orgId).eq('external_id', externalId).maybeSingle()
  if (existing) return NextResponse.json({ ok: true, duplicate: true, unit: serializeUnit(existing as Unit) })
  const slug = await uniqueUnitSlug(ctx.supabase, name, externalId)
  const { data, error } = await ctx.supabase.from('units').insert({
    org_id: ctx.orgId, external_id: externalId, name, slug,
    region_city: typeof body.city === 'string' ? body.city.trim().slice(0, 120) || null : null,
    region_state: typeof body.state === 'string' ? body.state.trim().slice(0, 80) || null : null,
    timezone: typeof body.timezone === 'string' ? body.timezone.trim().slice(0, 80) || 'America/Sao_Paulo' : 'America/Sao_Paulo',
    contact_email: typeof body.contact_email === 'string' ? body.contact_email.trim().toLowerCase().slice(0, 200) || null : null,
    contact_phone: typeof body.contact_phone === 'string' ? body.contact_phone.replace(/[^\d+]/g, '').slice(0, 30) || null : null,
    owner_name: typeof body.owner_name === 'string' ? body.owner_name.trim().slice(0, 160) || null : null,
    address: typeof body.address === 'string' ? body.address.trim().slice(0, 500) || null : null,
    crm_integration_mode: 'smarter', recruiting_integration_mode: 'smarter', is_active: true,
  }).select('*').single()
  if (error || !data) return partnerError(error?.code === '23505' ? 409 : 500, error?.code === '23505' ? 'external_id ou slug já está em uso.' : 'Não foi possível criar a unidade.')
  const templateVersion = await provisionPartnerUnit(ctx.supabase, { orgId: ctx.orgId, unitId: (data as Unit).id })
  const { data: final } = await ctx.supabase.from('units').select('*').eq('id', (data as Unit).id).single()
  return NextResponse.json({ ok: true, duplicate: false, template_version: templateVersion, unit: serializeUnit((final ?? data) as Unit) }, { status: 201 })
}
