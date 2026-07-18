import type { SupabaseClient } from '@supabase/supabase-js'
import type { Lead, Unit } from '@/lib/types'

// Handoff Sales → Receptionist (Fase 1, item 4): todo lead que fecha
// como ganho vira um Cliente automaticamente, independente do negócio
// também criar (ou não) uma vaga de recrutamento — são automações
// independentes disparadas pelo mesmo evento de fechamento.
//
// Idempotência via customers.lead_id + source='sales' (mesmo padrão
// de job_openings.lead_id em lib/sales/deal-handoff.ts): evita
// duplicar o cliente em retry de webhook.

export async function createCustomerFromDealLead(
  supabase: SupabaseClient,
  params: { lead: Lead; unit: Unit },
): Promise<{ created: boolean; error?: string }> {
  const { lead, unit } = params
  if (!unit.org_id) return { created: false, error: 'unidade sem org_id' }

  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('source', 'sales')
    .limit(1)
    .maybeSingle()
  if (existing) return { created: false }

  const notes = lead.contact_name ? `Contato: ${lead.contact_name}` : null

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
  })

  if (error) return { created: false, error: error.message }
  return { created: true }
}
