import type { SupabaseClient } from '@supabase/supabase-js'
import { closingFields } from '@/lib/conversation-engine'
import type { Lead, Unit } from '@/lib/types'

// Handoff Sales → Receptionist (Fase 1, item 4): todo lead que fecha
// como ganho vira um Cliente automaticamente, independente do negócio
// também criar (ou não) uma vaga de recrutamento — são automações
// independentes disparadas pelo mesmo evento de fechamento.
//
// Idempotência via customers.lead_id + source='sales' (mesmo padrão
// de job_openings.lead_id em lib/sales/deal-handoff.ts): evita
// duplicar o cliente em retry de webhook.

/**
 * O fechamento não tem um formato fixo de campos — são exatamente os
 * que a empresa ensinou em `business_profile.fechamento_campos` (ver
 * closingFields em lib/conversation-engine.ts), então o resumo usa a
 * "pergunta" de cada campo ensinado como rótulo, nunca um nome de
 * campo inventado. null quando não há nenhum campo ensinado ou
 * nenhum dado coletado — o chamador cai no texto fixo de fallback.
 */
function buildDealSummary(businessProfile: Record<string, unknown>, dealProfile: Record<string, unknown>): string | null {
  const fields = closingFields(businessProfile)
  if (fields.length === 0) return null

  const collected: string[] = []
  const pending: string[] = []
  for (const field of fields) {
    const value = dealProfile[field.chave]
    if (value === null || value === undefined || value === '') {
      pending.push(field.pergunta)
    } else {
      collected.push(`${field.pergunta}: ${String(value)}`)
    }
  }

  const parts: string[] = []
  if (collected.length > 0) parts.push(`Fechamento: ${collected.join('; ')}.`)
  if (pending.length > 0) parts.push(`Pendente: ${pending.join('; ')}.`)
  return parts.length > 0 ? parts.join(' ') : null
}

export async function createCustomerFromDealLead(
  supabase: SupabaseClient,
  params: { lead: Lead; unit: Unit; businessProfile: Record<string, unknown> },
): Promise<{ created: boolean; error?: string }> {
  const { lead, unit, businessProfile } = params
  if (!unit.org_id) return { created: false, error: 'unidade sem org_id' }

  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('source', 'sales')
    .limit(1)
    .maybeSingle()
  if (existing) return { created: false }

  const dealProfile = (lead.deal_profile ?? {}) as Record<string, unknown>
  const dealSummary = buildDealSummary(businessProfile, dealProfile)
  const notes = dealSummary ?? (lead.contact_name ? `Contato: ${lead.contact_name}` : null)

  const customFields: Record<string, unknown> = {}
  if (Object.keys(dealProfile).length > 0) customFields.deal_profile = dealProfile
  if (dealSummary) customFields.deal_summary = dealSummary

  const { error } = await supabase.from('customers').insert({
    org_id: unit.org_id,
    unit_id: unit.id,
    lead_id: lead.id,
    name: lead.company_name,
    phone: lead.phone,
    email: lead.email,
    city: lead.city,
    status: 'active',
    source: 'sales',
    notes,
    custom_fields: customFields,
  })

  if (error) return { created: false, error: error.message }
  return { created: true }
}

// Auto-provisionamento Recepcionista (item do pedido: "sem exigir cadastro
// prévio"): quando alguém que escreve na linha dedicada da Recepcionista
// (ainda não é `customers`, ver processReceptionistProspectInbound) pede
// pra agendar um serviço de verdade, a própria IA cria o cadastro na hora
// — nunca pede pra pessoa se cadastrar ela mesma. Idempotência via
// customers.lead_id + source='receptionist_self_service' (mesmo padrão de
// createCustomerFromDealLead acima), pra não duplicar em retry de webhook
// nem numa segunda mensagem de agendamento do mesmo contato.
export async function provisionCustomerFromLead(
  supabase: SupabaseClient,
  params: { lead: Lead; unit: Unit; contactName: string },
): Promise<{ customerId: string } | null> {
  const { lead, unit, contactName } = params
  if (!unit.org_id) return null

  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('source', 'receptionist_self_service')
    .limit(1)
    .maybeSingle()
  if (existing) return { customerId: (existing as { id: string }).id }

  const { data: inserted, error } = await supabase
    .from('customers')
    .insert({
      org_id: unit.org_id,
      unit_id: unit.id,
      lead_id: lead.id,
      name: contactName,
      phone: lead.phone,
      email: lead.email,
      city: lead.city,
      status: 'active',
      source: 'receptionist_self_service',
    })
    .select('id')
    .single()

  if (error || !inserted) return null
  return { customerId: (inserted as { id: string }).id }
}
