import type { SupabaseClient } from '@supabase/supabase-js'
import type { Unit } from '@/lib/types'

export type WhatsappConversationAgent = 'triage' | 'sdr' | 'receptionist' | 'recruiter' | 'human'

export type WhatsappConversationRoute = {
  id: string
  unit_id: string
  contact_key: string
  contact_phone: string | null
  contact_email: string | null
  agent_type: WhatsappConversationAgent
  previous_agent_type: WhatsappConversationAgent | null
  handoff_reason: string | null
  handoff_summary: string | null
  status: 'active' | 'paused' | 'closed'
  last_message_at: string
}

function normalizedPhone(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

export function whatsappContactKey(phone: string | null, email: string | null): string | null {
  const phoneDigits = normalizedPhone(phone)
  if (phoneDigits) return `phone:${phoneDigits}`
  const normalizedEmail = email?.trim().toLowerCase()
  return normalizedEmail ? `email:${normalizedEmail}` : null
}

export async function getWhatsappConversationRoute(
  supabase: SupabaseClient,
  unitId: string,
  phone: string | null,
  email: string | null,
): Promise<WhatsappConversationRoute | null> {
  const contactKey = whatsappContactKey(phone, email)
  if (!contactKey) return null

  const { data } = await supabase
    .from('whatsapp_conversation_routes')
    .select('*')
    .eq('unit_id', unitId)
    .eq('contact_key', contactKey)
    .eq('status', 'active')
    .maybeSingle()

  return (data as WhatsappConversationRoute | null) ?? null
}

/**
 * Define quem continua a conversa no número compartilhado. O upsert é
 * idempotente por (unit_id, contact_key), então reentregas de webhook não
 * criam duas propriedades concorrentes. Ao trocar de funcionário, preserva
 * o responsável anterior e o contexto do handoff para auditoria.
 */
export async function assignWhatsappConversation(params: {
  supabase: SupabaseClient
  unit: Pick<Unit, 'id' | 'org_id'>
  phone: string | null
  email: string | null
  agentType: WhatsappConversationAgent
  reason?: string | null
  summary?: string | null
  lastMessageAt?: string
}): Promise<void> {
  const { supabase, unit, phone, email, agentType, reason = null, summary = null } = params
  if (!unit.org_id) return
  const contactKey = whatsappContactKey(phone, email)
  if (!contactKey) return

  const existing = await getWhatsappConversationRoute(supabase, unit.id, phone, email)
  await supabase.from('whatsapp_conversation_routes').upsert(
    {
      org_id: unit.org_id,
      unit_id: unit.id,
      contact_key: contactKey,
      contact_phone: normalizedPhone(phone) || null,
      contact_email: email?.trim().toLowerCase() || null,
      agent_type: agentType,
      previous_agent_type:
        existing && existing.agent_type !== agentType ? existing.agent_type : existing?.previous_agent_type ?? null,
      handoff_reason: reason ?? existing?.handoff_reason ?? null,
      handoff_summary: summary ?? existing?.handoff_summary ?? null,
      status: 'active',
      last_message_at: params.lastMessageAt ?? new Date().toISOString(),
    },
    { onConflict: 'unit_id,contact_key' },
  )
}

/**
 * Mantém a Recepcionista como dona da conversa somente enquanto nenhum
 * handoff ocorreu durante o processamento da mensagem. Isso fecha a corrida
 * em que handoffToSales atribuía o SDR e, logo depois, o roteador sobrescrevia
 * a atribuição de volta para receptionist.
 */
export async function retainReceptionistOwnership(params: {
  supabase: SupabaseClient
  unit: Pick<Unit, 'id' | 'org_id'>
  phone: string | null
  email: string | null
  lastMessageAt?: string
}): Promise<void> {
  const { supabase, unit, phone, email, lastMessageAt } = params
  const current = await getWhatsappConversationRoute(supabase, unit.id, phone, email)
  if (current && current.agent_type !== 'triage' && current.agent_type !== 'receptionist') return

  await assignWhatsappConversation({
    supabase,
    unit,
    phone,
    email,
    agentType: 'receptionist',
    lastMessageAt,
  })
}
