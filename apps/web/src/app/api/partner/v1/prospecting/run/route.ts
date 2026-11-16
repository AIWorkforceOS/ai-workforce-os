import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'
import { getGoogleMapsApiKey } from '@/lib/google-places'
import { isWithinActiveHours } from '@/lib/conversation-engine'
import { runProspectingForUnit } from '@/lib/prospecting/engine'
import type { AgentConfig } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/partner/v1/prospecting/run (escopo prospecting:run)
 * Body: { unit_id | unit_slug }
 *
 * Dispara AGORA uma rodada de prospecção do Google Maps do Sales Rep da
 * unidade, com o perfil atual (agent_configs.prospecting_profile). Usa o
 * mesmo motor dos crons, então respeita: teto de 15 capturas novas/dia/
 * unidade (DAILY_CAPTURE_LIMIT), horário ativo, limite diário de mensagens
 * e as regras de prospecção fria (contato por e-mail, nunca WhatsApp frio).
 * Chamar várias vezes no dia é seguro: o teto diário vale para tudo.
 */
export async function POST(request: Request) {
  const ctx = await authenticatePartner(request, 'prospecting:run')
  if (!isPartnerContext(ctx)) return ctx

  const body = await request.json().catch(() => null)
  const unit = await resolvePartnerUnit(ctx, { unitId: body?.unit_id, unitSlug: body?.unit_slug })
  if (!unit) return partnerError(404, 'Unidade não encontrada.')

  const apiKey = getGoogleMapsApiKey()
  if (!apiKey) return partnerError(503, 'Prospecção indisponível: Google Maps não está configurado no Alizo.')

  const { data } = await ctx.supabase
    .from('agent_configs')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('agent_type', 'sdr')
    .maybeSingle()
  const config = data as AgentConfig | null
  if (!config?.is_active) return partnerError(409, 'O Sales Rep desta unidade não está ativo.')
  if (!isWithinActiveHours(config.active_hours)) {
    return partnerError(409, 'Fora do horário ativo configurado para o Sales Rep desta unidade.')
  }

  const startedAt = new Date().toISOString()
  const requestedLimit = Math.max(1, Math.min(15, Number(body?.limit) || 15))
  const profile = config.prospecting_profile ?? {}
  const regions = Array.isArray(profile.regions) && profile.regions.length ? profile.regions : [undefined]
  let captured = 0; let contacted = 0
  const deadline = Date.now() + 50_000
  for (const region of regions) {
    if (captured >= requestedLimit || Date.now() > deadline) break
    const result = await runProspectingForUnit({ supabase: ctx.supabase, unit, config, apiKey, deadline, region, captureLimit: requestedLimit - captured, firstContact: body?.first_contact ?? profile.first_contact })
    captured += result.captured; contacted += result.contacted
  }
  const { data: rows } = await ctx.supabase.from('leads').select('*').eq('unit_id', unit.id).eq('source', 'google_maps').gte('created_at', startedAt).order('created_at', { ascending: true }).limit(requestedLimit)
  return NextResponse.json({ ok: true, captured, contacted, leads: (rows ?? []).map((lead) => ({ id: lead.id, name: lead.company_name, address: lead.enrichment_data?.address ?? null, city: lead.city, state: lead.state, phone: lead.phone, email: lead.email ?? lead.enrichment_data?.contact_email ?? null, website: lead.enrichment_data?.website ?? null, category: lead.sector, rating: lead.enrichment_data?.rating ?? null, maps_url: lead.google_place_id ? `https://www.google.com/maps/place/?q=place_id:${lead.google_place_id}` : null, source: lead.source, region: { city: lead.city, state: lead.state } })) })
}
