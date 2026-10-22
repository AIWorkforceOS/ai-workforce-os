import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeClientName } from '@/lib/client-profiles/profile'

/**
 * Vincular uma WO a um cliente cadastrado: acha o "cadastro de cliente" da unidade (o que tem o nome do próprio cliente; na falta, o primeiro
 * vinculado a ele) ou cria um. A WO passa a apontar para ele (appointments.customer_id) — a loja/local continua nos dados da própria ordem.
 */
export async function resolveClientCustomerId(
  supabase: SupabaseClient,
  input: { unitId: string; orgId: string; clientName: string },
): Promise<{ ok: true; customerId: string } | { ok: false; error: string }> {
  const clientName = normalizeClientName(input.clientName)
  if (!clientName) return { ok: false, error: 'Escolha o cliente.' }
  const { data: rows } = await supabase.from('customers').select('id, name, client_company, created_at').eq('unit_id', input.unitId).ilike('client_company', clientName).limit(50)
  const list = (Array.isArray(rows) ? rows : []) as { id: string; name: string | null; client_company: string | null; created_at?: string }[]
  const same = list.filter((c) => normalizeClientName(c.client_company).toLowerCase() === clientName.toLowerCase())
  const exact = same.find((c) => normalizeClientName(c.name).toLowerCase() === clientName.toLowerCase())
  const found = exact ?? same.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))[0]
  if (found) return { ok: true, customerId: found.id }
  const { data: created, error } = await supabase
    .from('customers')
    .insert({ org_id: input.orgId, unit_id: input.unitId, name: clientName, client_company: clientName, source: 'client_profile' })
    .select('id')
    .single()
  if (error || !created) return { ok: false, error: 'Não foi possível cadastrar o cliente nesta unidade.' }
  return { ok: true, customerId: (created as { id: string }).id }
}

export async function linkAppointmentToClient(
  supabase: SupabaseClient,
  input: { appointmentId: string; unitId: string; orgId: string; clientName: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const customer = await resolveClientCustomerId(supabase, input)
  if (!customer.ok) return customer
  const { data, error } = await supabase.from('appointments').update({ customer_id: customer.customerId }).eq('id', input.appointmentId).eq('unit_id', input.unitId).select('id').maybeSingle()
  if (error || !data) return { ok: false, error: 'Não foi possível vincular a ordem ao cliente.' }
  return { ok: true }
}
