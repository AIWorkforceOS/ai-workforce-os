import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEscalationEmail } from '@/lib/email'
import { logSystemEvent, shouldNotifyForEvent } from '@/lib/system-events'
import { triggerFirstContact } from '@/lib/leads/lead-intake'
import type { Lead, Unit } from '@/lib/types'

// Handoff Receptionist → time humano (item 4 do pedido): mecanismo
// deliberadamente mais simples do que lib/sales/deal-handoff.ts (que
// cria vaga/registro automaticamente) — aqui a Recepcionista só
// precisa RECONHECER que não é ela quem resolve e avisar alguém, não
// executar a próxima etapa sozinha (abrir vaga, fechar venda). Cobre
// os 3 alvos citados pelo Dispatch (venda nova, vaga de emprego,
// qualquer outra coisa fora do escopo) com o mesmo texto — só muda o
// rótulo do time no e-mail — porque a ação de fato (uma pessoa olhar
// a conversa) é idêntica nos três casos.
//
// Exceção: target 'sales' (pedido explícito — "ela pode mandar e passar
// o lead para o sales") ganha um handoff de verdade além do e-mail: cria/
// reaproveita um Lead e aciona o mesmo motor de primeiro contato do Sales
// Rep (triggerFirstContact, lib/leads/lead-intake.ts) — reaproveita a
// checagem de active_hours/daily_limit/claim atômico e a política de
// canal já existentes (só e-mail para prospecção fria; aqui a origem não
// é fria, a pessoa já escreveu pra empresa, então WhatsApp/SMS também
// valem). 'recruiting'/'human' continuam só notificação: não existe hoje
// um ponto de entrada equivalente a triggerFirstContact para o Recruiter
// partir do zero sem uma vaga/candidatura já existente.

export type HandoffTarget = 'sales' | 'recruiting' | 'human'

export type HandoffContact = { name: string; phone: string | null; email: string | null }

const TARGET_LABEL: Record<HandoffTarget, string> = {
  sales: 'comercial/vendas',
  recruiting: 'recrutamento',
  human: 'atendimento humano',
}

/**
 * Registra a escalação (system_events, sempre) e avisa o dono da
 * organização por e-mail (best-effort, com a mesma janela anti-spam de
 * 6h por tipo de evento/unidade usada pelo SDR). Nunca lança — uma
 * falha aqui não pode travar a resposta ao cliente. `contact` é genérico
 * (nome/telefone/e-mail) para servir tanto um Customer cadastrado quanto
 * um Lead/prospecto sem cadastro (franqueado, lead de franquia, estudante
 * — ver processReceptionistProspectInbound em lib/receptionist/engine.ts).
 */
export async function notifyReceptionistHandoff(
  supabase: SupabaseClient,
  params: { unit: Unit; contact: HandoffContact; target: HandoffTarget; reason: string; lastMessage: string; contactId?: string },
): Promise<void> {
  const { unit, contact, target, reason, lastMessage, contactId } = params
  const eventType = `receptionist_handoff_${target}`

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'receptionist',
    eventType,
    message: `Contato "${contact.name}" precisa de ${TARGET_LABEL[target]}: ${reason}`,
    orgId: unit.org_id,
    unitId: unit.id,
    metadata: { contact_id: contactId ?? null, target, last_message: lastMessage.slice(0, 300) },
  })

  if (!unit.org_id) return
  const notify = await shouldNotifyForEvent(supabase, { eventType, unitId: unit.id })
  if (!notify) return

  const { data: org } = await supabase.from('organizations').select('owner_email').eq('id', unit.org_id).maybeSingle()
  const ownerEmail = (org as { owner_email: string | null } | null)?.owner_email
  if (!ownerEmail) return

  const result = await sendEscalationEmail({
    to: ownerEmail,
    unitName: unit.name,
    leadName: contact.name,
    leadPhone: contact.phone,
    reason: `[${TARGET_LABEL[target]}] ${reason}`,
    lastMessage,
    agentLabel: 'AI Receptionist',
  })

  if (!result.ok) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'resend',
      eventType: 'receptionist_handoff_email_failed',
      message: `Handoff do contato "${contact.name}" registrado, mas o e-mail de aviso falhou: ${result.error ?? 'erro desconhecido'}`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
  }
}

function normalizePhoneDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

function phoneMatches(a: string, b: string): boolean {
  return a.length > 0 && b.length > 0 && (a.endsWith(b.slice(-8)) || b.endsWith(a.slice(-8)))
}

/** Acha um lead existente pelo mesmo telefone/e-mail nesta unidade (evita duplicar a cada nova mensagem de handoff), ou cria um novo com source='receptionist_handoff'. */
async function findOrCreateHandoffLead(
  supabase: SupabaseClient,
  unit: Unit,
  contact: HandoffContact,
): Promise<Lead | null> {
  if (!contact.phone && !contact.email) return null

  const { data: leadsData } = await supabase.from('leads').select('*').eq('unit_id', unit.id)
  const leads = (leadsData as Lead[] | null) ?? []
  const incomingPhone = normalizePhoneDigits(contact.phone)
  const existing = leads.find((row) => {
    if (contact.phone && phoneMatches(normalizePhoneDigits(row.phone), incomingPhone)) return true
    if (contact.email && row.email && row.email.trim().toLowerCase() === contact.email.trim().toLowerCase()) return true
    return false
  })
  if (existing) return existing

  const { data: inserted } = await supabase
    .from('leads')
    .insert({
      unit_id: unit.id,
      phone: contact.phone,
      email: contact.email,
      company_name: contact.name,
      contact_name: contact.name,
      source: 'receptionist_handoff',
      status: 'new',
    })
    .select()
    .single()

  return (inserted as Lead | null) ?? null
}

/**
 * Handoff de verdade Recepcionista → Sales: encontra/cria o Lead deste
 * contato e aciona o primeiro contato automático do Sales Rep sobre ele
 * (mesma infra de lib/leads/lead-intake.ts — respeita agente ativo,
 * horário, limite diário e claim atômico). Nunca lança: falha aqui já foi
 * registrada por notifyReceptionistHandoff (chamado antes) e por
 * triggerFirstContact internamente — o cliente já recebeu a resposta da
 * Recepcionista independente do resultado deste acionamento.
 */
export async function handoffToSales(
  supabase: SupabaseClient,
  params: { unit: Unit; contact: HandoffContact },
): Promise<void> {
  const { unit, contact } = params
  try {
    const lead = await findOrCreateHandoffLead(supabase, unit, contact)
    if (!lead) return
    await triggerFirstContact(supabase, unit, lead)
  } catch (error) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'sales',
      eventType: 'receptionist_handoff_sales_trigger_failed',
      message: `Handoff da Recepcionista para o Sales Rep falhou ao acionar o primeiro contato do lead "${contact.name}": ${error instanceof Error ? error.message : String(error)}`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
  }
}
