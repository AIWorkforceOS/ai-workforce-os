import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'
import type { AgentConfig, ProspectingProfile } from '@/lib/types'

export const dynamic = 'force-dynamic'

function cleanStrings(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item ?? '').trim().slice(0, 100))
    .filter((item) => item.length > 0)
    .slice(0, max)
}

async function loadConfig(
  ctx: Parameters<typeof resolvePartnerUnit>[0],
  unitRef: { unitId?: unknown; unitSlug?: unknown },
) {
  const unit = await resolvePartnerUnit(ctx, unitRef)
  if (!unit) return null
  const { data } = await ctx.supabase
    .from('agent_configs')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('agent_type', 'sdr')
    .maybeSingle()
  return { unit, config: data as AgentConfig | null }
}

/** GET /api/partner/v1/prospecting/profile?unit_id= (escopo prospecting:write) */
export async function GET(request: Request) {
  const ctx = await authenticatePartner(request, 'prospecting:write')
  if (!isPartnerContext(ctx)) return ctx

  const search = new URL(request.url).searchParams
  const found = await loadConfig(ctx, { unitId: search.get('unit_id'), unitSlug: search.get('unit_slug') })
  if (!found) return partnerError(404, 'Unidade não encontrada.')
  if (!found.config) return partnerError(409, 'Esta unidade ainda não tem Sales Rep contratado.')

  return NextResponse.json({ unit_id: found.unit.id, profile: found.config.prospecting_profile ?? {} })
}

/**
 * PUT /api/partner/v1/prospecting/profile (escopo prospecting:write)
 * Body: { unit_id | unit_slug, mode?: 'business_types'|'general', business_types?: string[],
 *         region?: string, general_sector?: string, headcount_range?: string }
 *
 * Define o que o Sales Rep busca no Google Maps nas próximas rodadas.
 * Não ativa o agente nem altera horário/limites — isso continua no painel do Alizo.
 */
export async function PUT(request: Request) {
  const ctx = await authenticatePartner(request, 'prospecting:write')
  if (!isPartnerContext(ctx)) return ctx

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return partnerError(400, 'Payload inválido.')

  const found = await loadConfig(ctx, { unitId: body.unit_id, unitSlug: body.unit_slug })
  if (!found) return partnerError(404, 'Unidade não encontrada.')
  if (!found.config) return partnerError(409, 'Esta unidade ainda não tem Sales Rep contratado.')

  if (body.mode !== undefined && body.mode !== 'business_types' && body.mode !== 'general') {
    return partnerError(400, 'mode deve ser "business_types" ou "general".')
  }

  const profile: ProspectingProfile = { ...(found.config.prospecting_profile ?? {}) }
  if (body.mode !== undefined) profile.mode = body.mode
  if (body.business_types !== undefined) profile.business_types = cleanStrings(body.business_types)
  if (body.region !== undefined) profile.region = typeof body.region === 'string' ? body.region.trim().slice(0, 120) || null : null
  if (body.general_sector !== undefined) {
    profile.general_sector = typeof body.general_sector === 'string' ? body.general_sector.trim().slice(0, 120) || null : null
  }
  if (body.headcount_range !== undefined) {
    profile.headcount_range = typeof body.headcount_range === 'string' ? body.headcount_range.trim().slice(0, 60) || null : null
  }

  const { error } = await ctx.supabase
    .from('agent_configs')
    .update({ prospecting_profile: profile })
    .eq('id', found.config.id)
  if (error) return partnerError(500, 'Não foi possível salvar o perfil de prospecção.')

  return NextResponse.json({ ok: true, unit_id: found.unit.id, profile })
}
