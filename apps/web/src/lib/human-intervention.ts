import type { SupabaseClient } from '@supabase/supabase-js'
import { logSystemEvent } from '@/lib/system-events'
import type { Unit } from '@/lib/types'

export const HUMAN_OPERATOR_MESSAGE_EVENT_TYPE = 'human_operator_message'
export const HUMAN_INTERVENTION_RELEASED_EVENT_TYPE = 'human_intervention_released'

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

/**
 * Devolve a conversa pra automação antes dos 40min expirarem — ação
 * explícita do operador na Caixa de Entrada ("Devolver à automação").
 * system_events é append-only (é a trilha de auditoria do produto): não
 * apaga o evento de trava anterior, grava um evento mais recente que
 * isHumanInterventionActive passa a considerar como destrava.
 */
export async function releaseHumanIntervention(
  supabase: SupabaseClient,
  params: { unit: Unit; contactId: string },
): Promise<void> {
  await logSystemEvent(supabase, {
    level: 'info',
    source: 'system',
    eventType: HUMAN_INTERVENTION_RELEASED_EVENT_TYPE,
    message: `Atendimento devolvido à automação manualmente na unidade "${params.unit.name}".`,
    orgId: params.unit.org_id,
    unitId: params.unit.id,
    metadata: { contact_id: params.contactId },
  })
}

/** True se um humano interveio manualmente nesta conversa nos últimos HUMAN_INTERVENTION_LOCK_MINUTES (e ninguém devolveu à automação depois) — todo motor reativo deve checar isto antes de gerar/enviar qualquer resposta automática. */
export async function isHumanInterventionActive(
  supabase: SupabaseClient,
  params: { unitId: string; contactId: string },
): Promise<boolean> {
  const latest = await latestInterventionEventType(supabase, params)
  return latest === HUMAN_OPERATOR_MESSAGE_EVENT_TYPE
}

/**
 * Evento mais recente (trava ou destrava) pra este contato dentro da
 * janela — usado por isHumanInterventionActive e pela Caixa de Entrada pra
 * decidir se mostra "Assumir" ou "Devolver à automação". Filtra contact_id
 * em memória (mesmo motivo do hasRecentEventForContact em
 * system-events.ts: volume baixo por unidade/janela, não vale a
 * complexidade de um filtro JSON no Postgres pra isso). Em erro, retorna
 * null (= não trava) — mesma postura fail-open do resto do módulo.
 * Desempate: ordena por created_at; system_events não tem coluna
 * sequencial, então dois eventos no mesmíssimo timestamp (praticamente
 * impossível em produção — inserts separados por round-trip de rede) têm
 * ordem indefinida.
 */
export async function latestInterventionEventType(
  supabase: SupabaseClient,
  params: { unitId: string; contactId: string },
): Promise<typeof HUMAN_OPERATOR_MESSAGE_EVENT_TYPE | typeof HUMAN_INTERVENTION_RELEASED_EVENT_TYPE | null> {
  const windowStart = new Date(Date.now() - HUMAN_INTERVENTION_LOCK_MINUTES * 60 * 1000).toISOString()

  try {
    const { data, error } = await supabase
      .from('system_events')
      .select('event_type, metadata, created_at')
      .in('event_type', [HUMAN_OPERATOR_MESSAGE_EVENT_TYPE, HUMAN_INTERVENTION_RELEASED_EVENT_TYPE])
      .eq('unit_id', params.unitId)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) return null
    const rows = (data as { event_type: string; metadata: Record<string, unknown> | null }[] | null) ?? []
    const match = rows.find((row) => (row.metadata as Record<string, unknown> | null)?.contact_id === params.contactId)
    return (match?.event_type as typeof HUMAN_OPERATOR_MESSAGE_EVENT_TYPE | typeof HUMAN_INTERVENTION_RELEASED_EVENT_TYPE | undefined) ?? null
  } catch {
    return null
  }
}
