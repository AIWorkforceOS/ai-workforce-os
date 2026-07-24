import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEscalationEmail } from '@/lib/email'
import { logSystemEvent, shouldNotifyForEvent } from '@/lib/system-events'
import type { Customer, Unit } from '@/lib/types'

// Handoff Receptionist → time humano (item 4 do pedido): mecanismo
// deliberadamente mais simples do que lib/sales/deal-handoff.ts (que
// cria vaga/registro automaticamente) — aqui a Recepcionista só
// precisa RECONHECER que não é ela quem resolve e avisar alguém, não
// executar a próxima etapa sozinha (abrir vaga, fechar venda). Cobre
// os 3 alvos citados pelo Dispatch (venda nova, vaga de emprego,
// qualquer outra coisa fora do escopo) com o mesmo texto — só muda o
// rótulo do time no e-mail — porque a ação de fato (uma pessoa olhar
// a conversa) é idêntica nos três casos.

export type HandoffTarget = 'sales' | 'recruiting' | 'human'

const TARGET_LABEL: Record<HandoffTarget, string> = {
  sales: 'comercial/vendas',
  recruiting: 'recrutamento',
  human: 'atendimento humano',
}

/**
 * Registra a escalação (system_events, sempre) e avisa o dono da
 * organização por e-mail (best-effort, com a mesma janela anti-spam de
 * 6h por tipo de evento/unidade usada pelo SDR). Nunca lança — uma
 * falha aqui não pode travar a resposta ao cliente.
 */
export async function notifyReceptionistHandoff(
  supabase: SupabaseClient,
  params: { unit: Unit; customer: Customer; target: HandoffTarget; reason: string; lastMessage: string },
): Promise<void> {
  const { unit, customer, target, reason, lastMessage } = params
  const eventType = `receptionist_handoff_${target}`

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'receptionist',
    eventType,
    message: `Cliente "${customer.name}" precisa de ${TARGET_LABEL[target]}: ${reason}`,
    orgId: unit.org_id,
    unitId: unit.id,
    metadata: { customer_id: customer.id, target, last_message: lastMessage.slice(0, 300) },
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
    leadName: customer.name,
    leadPhone: customer.phone,
    reason: `[${TARGET_LABEL[target]}] ${reason}`,
    lastMessage,
    agentLabel: 'AI Receptionist',
  })

  if (!result.ok) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'resend',
      eventType: 'receptionist_handoff_email_failed',
      message: `Handoff do cliente "${customer.name}" registrado, mas o e-mail de aviso falhou: ${result.error ?? 'erro desconhecido'}`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
  }
}
