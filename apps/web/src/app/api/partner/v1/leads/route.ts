import { NextResponse } from 'next/server'
import {
  authenticatePartner,
  isPartnerContext,
  listPartnerUnitIds,
  partnerError,
  resolvePartnerUnit,
} from '@/lib/partner-api/auth'
import { parseLimit, serializeLead } from '@/lib/partner-api/serialize'
import { emitPartnerEvent } from '@/lib/partner-api/webhooks'
import { triggerFirstContact } from '@/lib/leads/lead-intake'
import { syncLeadToSmarterCrm } from '@/lib/sales/smarter-crm'
import type { Lead } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/partner/v1/leads (escopo leads:write)
 * Body: { unit_id | unit_slug, name, phone, email?, source?, notes?,
 *         external_id?, first_contact? (padrão true) }
 *
 * - Idempotente: mesmo telefone na unidade, ou mesmo (source, external_id),
 *   devolve o lead existente com duplicate=true e NÃO dispara novo contato.
 * - first_contact=true: o Sales Rep do Alizo faz o primeiro contato (respeita
 *   agente ativo, horário ativo e limite diário — pode ficar para depois).
 * - first_contact=false: lead entra como 'paused', fora de qualquer
 *   automação (prospecção/follow-up), para uso do Recrutador ou contato
 *   posterior via POST /leads/{id}/messages.
 */
export async function POST(request: Request) {
  const ctx = await authenticatePartner(request, 'leads:write')
  if (!isPartnerContext(ctx)) return ctx

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return partnerError(400, 'Payload inválido.')

  const unit = await resolvePartnerUnit(ctx, { unitId: body.unit_id, unitSlug: body.unit_slug })
  if (!unit) return partnerError(404, 'Unidade não encontrada.')

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return partnerError(400, 'name é obrigatório.')

  const phone = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : ''
  if (phone.length < 10) return partnerError(400, 'phone inválido (mínimo 10 dígitos).')

  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null
  const source =
    typeof body.source === 'string' && body.source.trim() ? body.source.trim().slice(0, 80) : 'partner_api'
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null
  const externalId =
    typeof body.external_id === 'string' && body.external_id.trim() ? body.external_id.trim().slice(0, 120) : null
  const firstContact = body.first_contact !== false

  if (externalId) {
    const { data: byExternal } = await ctx.supabase
      .from('leads')
      .select('*')
      .eq('unit_id', unit.id)
      .eq('source', source)
      .eq('external_lead_id', externalId)
      .maybeSingle()
    if (byExternal) {
      return NextResponse.json({ ok: true, duplicate: true, lead: serializeLead(byExternal as Lead) })
    }
  }

  const { data: byPhone } = await ctx.supabase
    .from('leads')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('phone', phone)
    .maybeSingle()
  if (byPhone) {
    return NextResponse.json({ ok: true, duplicate: true, lead: serializeLead(byPhone as Lead) })
  }

  const { data: inserted, error } = await ctx.supabase
    .from('leads')
    .insert({
      unit_id: unit.id,
      company_name: name,
      contact_name: name,
      phone,
      email,
      source,
      notes,
      external_lead_id: externalId,
      status: firstContact ? 'new' : 'paused',
    })
    .select()
    .single()

  if (error || !inserted) return partnerError(500, 'Erro ao criar lead.')

  const lead = inserted as Lead
  await syncLeadToSmarterCrm(ctx.supabase, unit, lead)

  let contacted = false
  if (firstContact) {
    try {
      contacted = await triggerFirstContact(ctx.supabase, unit, lead)
    } catch (err) {
      console.error(`[partner_api] primeiro contato falhou: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const { data: finalLead } = await ctx.supabase.from('leads').select('*').eq('id', lead.id).maybeSingle()
  const result = (finalLead as Lead | null) ?? lead

  await emitPartnerEvent(ctx.supabase, {
    orgId: unit.org_id,
    unitId: unit.id,
    type: 'lead.created',
    data: { lead: serializeLead(result), contacted },
  })

  return NextResponse.json({ ok: true, duplicate: false, contacted, lead: serializeLead(result) }, { status: 201 })
}

/**
 * GET /api/partner/v1/leads (escopo leads:read)
 * Query: unit_id?, status?, updated_since? (ISO), limit? (<=100), before? (created_at ISO, paginação)
 */
export async function GET(request: Request) {
  const ctx = await authenticatePartner(request, 'leads:read')
  if (!isPartnerContext(ctx)) return ctx

  const params = new URL(request.url).searchParams

  let unitIds: string[]
  const unitParam = params.get('unit_id')
  if (unitParam) {
    const unit = await resolvePartnerUnit(ctx, { unitId: unitParam })
    if (!unit) return partnerError(404, 'Unidade não encontrada.')
    unitIds = [unit.id]
  } else {
    unitIds = await listPartnerUnitIds(ctx)
  }
  if (unitIds.length === 0) return NextResponse.json({ leads: [], next_before: null })

  const limit = parseLimit(params.get('limit'))
  let query = ctx.supabase.from('leads').select('*').in('unit_id', unitIds)
  const status = params.get('status')
  if (status) query = query.eq('status', status)
  const updatedSince = params.get('updated_since')
  if (updatedSince) query = query.gte('updated_at', updatedSince)
  const before = params.get('before')
  if (before) query = query.lt('created_at', before)

  const { data } = await query.order('created_at', { ascending: false }).limit(limit)
  const leads = (data as Lead[] | null) ?? []
  return NextResponse.json({
    leads: leads.map(serializeLead),
    next_before: leads.length === limit ? leads[leads.length - 1]!.created_at : null,
  })
}
