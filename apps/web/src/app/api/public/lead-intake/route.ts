import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createAdLead } from '@/lib/leads/ad-lead-intake'
import type { Unit } from '@/lib/types'

/**
 * Intake público de lead por unidade (fonte externa → Sales Rep do Alizo).
 *
 * Usado por sistemas fora do Alizo (ex.: landing pages da Smarter com a
 * assistente "Lia") que já coletaram nome+telefone e querem entregar o
 * lead para a unidade certa disparar o primeiro contato — sem login de
 * usuário Alizo. Token público de baixo risco, escopado a uma única
 * unidade (units.public_lead_intake_token, migration 022): se vazar, o
 * pior caso é leads falsos naquela unidade. Não confundir com os tokens
 * de parceiro (smarter_crm_partner_token / smarter_recruiting_partner_token),
 * que são a direção oposta (Alizo escrevendo na Smarter).
 *
 * POST /api/public/lead-intake
 * Headers: { Authorization: Bearer <units.public_lead_intake_token> }
 * Body: { name: string, phone: string, source: string, note?: string }
 */

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 10

// Best-effort: em memória por instância (sem KV/Redis compartilhado no
// stack hoje). Suficiente para conter spam básico de um único token; não
// é uma garantia distribuída entre instâncias serverless.
const rateLimitHits = new Map<string, number[]>()

function isRateLimited(token: string): boolean {
  const now = Date.now()
  const hits = (rateLimitHits.get(token) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  hits.push(now)
  rateLimitHits.set(token, hits)
  return hits.length > RATE_LIMIT_MAX_REQUESTS
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization') ?? ''
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

  if (!bearerToken) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  if (isRateLimited(bearerToken)) {
    return NextResponse.json({ error: 'Muitas requisições. Tente novamente em instantes.' }, { status: 429 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const { data: unitData } = await supabase
    .from('units')
    .select('*')
    .eq('public_lead_intake_token', bearerToken)
    .eq('is_active', true)
    .maybeSingle()

  if (!unitData) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const unit = unitData as Unit

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const { name, phone, source, note } = body
  if (!name || typeof name !== 'string' || !phone || typeof phone !== 'string' || !source || typeof source !== 'string') {
    return NextResponse.json({ error: 'name, phone e source são obrigatórios.' }, { status: 400 })
  }

  const normalizedPhone = phone.replace(/\D/g, '')
  if (normalizedPhone.length < 10) {
    return NextResponse.json({ error: 'Telefone inválido.' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('leads')
    .select('id')
    .eq('unit_id', unit.id)
    .eq('phone', normalizedPhone)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ ok: true, lead_id: existing.id, duplicate: true })
  }

  const result = await createAdLead(supabase, {
    unit,
    lead: {
      name,
      phone: normalizedPhone,
      email: null,
      source,
      notes: typeof note === 'string' ? note : null,
    },
  })

  if (!result) {
    return NextResponse.json({ error: 'Erro ao criar lead.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, lead_id: result.leadId, contacted: result.contacted })
}
