import type { SupabaseClient } from '@supabase/supabase-js'
import { hasRecentEventForContact, logSystemEvent } from '@/lib/system-events'
import type { Unit } from '@/lib/types'

export const HUMAN_OPERATOR_MESSAGE_EVENT_TYPE = 'human_operator_message'

/**
 * Janela de trava: quando um humano de verdade intervém manualmente numa
 * conversa (digita direto no WhatsApp conectado), nenhum funcionário de IA
 * reativo pode responder por cima na mesma conversa por 40 minutos a partir
 * da última mensagem humana detectada — pedido explícito do dono (evita a
 * IA atropelar quem já está atendendo). Passado o prazo sem nova mensagem
 * humana, volta ao normal sozinho (é só a janela de tempo, sem job/cron).
 */
export const HUMAN_INTERVENTION_LOCK_MINUTES = 40

/** Registra que um humano (equipe) escreveu manualmente pra este contato — ver captureOperatorMessage em app/api/webhooks/whatsapp/route.ts. */
export async function recordHumanIntervention(
  supabase: SupabaseClient,
  params: { unit: Unit; contactId: string },
): Promise<void> {
  await logSystemEvent(supabase, {
    level: 'info',
    source: 'system',
    eventType: HUMAN_OPERATOR_MESSAGE_EVENT_TYPE,
    message: `Intervenção humana manual detectada na unidade "${params.unit.name}" — respostas automáticas travadas por ${HUMAN_INTERVENTION_LOCK_MINUTES}min para este contato.`,
    orgId: params.unit.org_id,
    unitId: params.unit.id,
    metadata: { contact_id: params.contactId },
  })
}

/** True se um humano interveio manualmente nesta conversa nos últimos HUMAN_INTERVENTION_LOCK_MINUTES — todo motor reativo deve checar isto antes de gerar/enviar qualquer resposta automática. */
export async function isHumanInterventionActive(
  supabase: SupabaseClient,
  params: { unitId: string; contactId: string },
): Promise<boolean> {
  return hasRecentEventForContact(supabase, {
    eventType: HUMAN_OPERATOR_MESSAGE_EVENT_TYPE,
    unitId: params.unitId,
    contactId: params.contactId,
    windowMinutes: HUMAN_INTERVENTION_LOCK_MINUTES,
  })
}
