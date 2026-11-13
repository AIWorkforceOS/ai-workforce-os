import { NextResponse } from 'next/server'
import {
  authenticatePartner,
  isPartnerContext,
  partnerError,
  resolvePartnerUnit,
  type PartnerContext,
} from '@/lib/partner-api/auth'
import { parseLimit, serializeMessage } from '@/lib/partner-api/serialize'
import { emitPartnerEvent } from '@/lib/partner-api/webhooks'
import { countSentToday, sendAcrossChannels } from '@/lib/conversation-engine'
import type { AgentConfig, Conversation, Lead } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_TEXT = 2000

async function loadLead(ctx: PartnerContext, id: string) {
  const { data } = await ctx.supabase.from('leads').select('*').eq('id', id).maybeSingle()
  const lead = data as Lead | null
  if (!lead) return null
  const unit = await resolvePartnerUnit(ctx, { unitId: lead.unit_id })
  return unit ? { lead, unit } : null
}

/** GET /api/partner/v1/leads/{id}/messages (escopo messages:read) — mais recentes primeiro. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'messages:read')
  if (!isPartnerContext(ctx)) return ctx

  const { id } = await params
  const found = await loadLead(ctx, id)
  if (!found) return partnerError(404, 'Lead não encontrado.')

  const search = new URL(request.url).searchParams
  const limit = parseLimit(search.get('limit'))
  let query = ctx.supabase.from('conversations').select('*').eq('lead_id', found.lead.id)
  const before = search.get('before')
  if (before) query = query.lt('sent_at', before)

  const { data } = await query.order('sent_at', { ascending: false }).limit(limit)
  const messages = (data as Conversation[] | null) ?? []
  return NextResponse.json({
    messages: messages.map(serializeMessage),
    next_before: messages.length === limit ? messages[messages.length - 1]!.sent_at : null,
  })
}

/**
 * POST /api/partner/v1/leads/{id}/messages (escopo messages:send)
 * Body: { text }  ·  Header opcional: Idempotency-Key (recomendado)
 *
 * Envia uma mensagem escrita pelo parceiro pelo canal do Sales Rep da
 * unidade (WhatsApp dedicado/compartilhado e/ou e-mail). Conta no limite
 * diário de mensagens do agente (429 quando estoura) — a mesma proteção
 * contra bloqueio do WhatsApp que vale para os disparos automáticos.
 * A resposta do lead continua sendo atendida pela IA.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'messages:send')
  if (!isPartnerContext(ctx)) return ctx

  const { id } = await params
  const found = await loadLead(ctx, id)
  if (!found) return partnerError(404, 'Lead não encontrado.')
  const { lead, unit } = found

  const body = await request.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) return partnerError(400, 'text é obrigatório.')
  if (text.length > MAX_TEXT) return partnerError(400, `text excede ${MAX_TEXT} caracteres.`)

  if (!lead.phone && !lead.email) return partnerError(400, 'Lead sem telefone nem e-mail.')

  const idempotencyKey = request.headers.get('idempotency-key')?.trim().slice(0, 100) || null
  const templateKey = idempotencyKey ? `partner:${idempotencyKey}` : 'partner_api'
  if (idempotencyKey) {
    const { data: previous } = await ctx.supabase
      .from('conversations')
      .select('*')
      .eq('lead_id', lead.id)
      .eq('direction', 'outbound')
      .eq('template_key', templateKey)
      .limit(1)
    const first = ((previous as Conversation[] | null) ?? [])[0]
    if (first) return NextResponse.json({ ok: true, duplicate: true, message: serializeMessage(first) })
  }

  const { data: agentConfig } = await ctx.supabase
    .from('agent_configs')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('agent_type', 'sdr')
    .maybeSingle()
  const config = agentConfig as AgentConfig | null
  if (!config?.is_active) return partnerError(409, 'O Sales Rep desta unidade não está ativo.')

  const sentToday = await countSentToday(ctx.supabase, unit.id)
  if (sentToday >= config.daily_limit) return partnerError(429, 'Limite diário de mensagens do agente atingido.')

  const { anySent, attempts } = await sendAcrossChannels({
    supabase: ctx.supabase,
    unit,
    lead,
    text,
    subject: `${config.persona_name} · ${unit.name}`,
    personaName: config.persona_name,
    templateKey,
  })

  if (!anySent) {
    const errors = attempts.map((a) => a.error).filter(Boolean).join(' | ')
    return partnerError(502, errors || 'Não foi possível enviar pelos canais configurados.')
  }

  const sentAt = new Date().toISOString()
  await ctx.supabase
    .from('leads')
    .update({ status: lead.status === 'new' || lead.status === 'paused' ? 'contacted' : lead.status, last_contacted_at: sentAt })
    .eq('id', lead.id)

  await emitPartnerEvent(ctx.supabase, {
    orgId: unit.org_id,
    unitId: unit.id,
    type: 'lead.message.sent',
    data: { lead_id: lead.id, text, origin: 'partner_api' },
  })

  return NextResponse.json({ ok: true, duplicate: false, channels: attempts.map((a) => ({ channel: a.channel, ok: a.ok })) }, { status: 201 })
}
