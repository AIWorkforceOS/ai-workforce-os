import type { Conversation, Lead, Unit } from '@/lib/types'

// Formato público (estável) devolvido pela API de parceiro. Só expõe campos
// que o parceiro precisa — nunca tokens, credenciais da Evolution/Twilio nem
// dados de cobrança da unidade.

export function serializeUnit(unit: Unit) {
  const extended = unit as Unit & { external_id?: string | null; contact_email?: string | null; contact_phone?: string | null; owner_name?: string | null; address?: string | null; template_version?: number }
  return {
    id: unit.id,
    slug: unit.slug,
    name: unit.name,
    city: unit.region_city,
    state: unit.region_state,
    whatsapp_phone: unit.whatsapp_phone,
    timezone: unit.timezone,
    external_id: extended.external_id ?? null,
    contact_email: extended.contact_email ?? null,
    contact_phone: extended.contact_phone ?? null,
    owner_name: extended.owner_name ?? null,
    address: extended.address ?? null,
    template_version: extended.template_version ?? 1,
    is_active: unit.is_active,
  }
}

export function serializeLead(lead: Lead) {
  return {
    id: lead.id,
    unit_id: lead.unit_id,
    name: lead.contact_name,
    company_name: lead.company_name,
    phone: lead.phone,
    email: lead.email,
    source: lead.source,
    external_id: lead.external_lead_id,
    status: lead.status,
    notes: lead.notes,
    last_contacted_at: lead.last_contacted_at,
    deal_closed_at: lead.deal_closed_at,
    created_at: lead.created_at,
    updated_at: lead.updated_at,
  }
}

export function serializeMessage(message: Conversation) {
  return {
    id: message.id,
    lead_id: message.lead_id,
    channel: message.channel,
    direction: message.direction,
    content: message.content,
    status: message.status,
    sent_at: message.sent_at,
  }
}

/** Limite de página: padrão 50, máximo 100. */
export function parseLimit(raw: string | null, fallback = 50, max = 100): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), max)
}
