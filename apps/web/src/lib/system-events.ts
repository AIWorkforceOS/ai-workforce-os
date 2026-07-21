import type { SupabaseClient } from '@supabase/supabase-js'

export type SystemEventLevel = 'info' | 'warning' | 'error'
export type SystemEventSource =
  | 'openai'
  | 'evolution'
  | 'twilio'
  | 'google_maps'
  | 'resend'
  | 'cron'
  | 'system'
  | 'meta_ads'
  | 'google_ads'
  | 'traffic'
  | 'recruiter'
  | 'job_board'
  | 'sales'
  | 'smarter_crm'
  | 'receptionist'
  | 'scheduling'

export type SystemEventInput = {
  level: SystemEventLevel
  source: SystemEventSource
  eventType: string
  message: string
  orgId?: string | null
  unitId?: string | null
  leadId?: string | null
  metadata?: Record<string, unknown>
}

export type SystemEvent = {
  id: string
  org_id: string | null
  unit_id: string | null
  lead_id: string | null
  level: SystemEventLevel
  source: SystemEventSource
  event_type: string
  message: string
  metadata: Record<string, unknown>
  created_at: string
}

/**
 * Registra um evento de sistema (falha de configuração, erro de API
 * externa, execução de cron) na tabela system_events e no log do
 * servidor. Nunca lança — logging não pode derrubar o fluxo principal.
 */
export async function logSystemEvent(
  supabase: SupabaseClient | null,
  event: SystemEventInput,
): Promise<void> {
  const logLine = JSON.stringify({
    at: new Date().toISOString(),
    level: event.level,
    source: event.source,
    event_type: event.eventType,
    message: event.message,
    org_id: event.orgId ?? null,
    unit_id: event.unitId ?? null,
    lead_id: event.leadId ?? null,
    ...event.metadata,
  })

  if (event.level === 'error') console.error(`[system_event] ${logLine}`)
  else if (event.level === 'warning') console.warn(`[system_event] ${logLine}`)
  else console.log(`[system_event] ${logLine}`)

  if (!supabase) return

  try {
    const { error } = await supabase.from('system_events').insert({
      level: event.level,
      source: event.source,
      event_type: event.eventType,
      message: event.message,
      org_id: event.orgId ?? null,
      unit_id: event.unitId ?? null,
      lead_id: event.leadId ?? null,
      metadata: event.metadata ?? {},
    })
    if (error) console.error(`[system_event] falha ao gravar evento: ${error.message}`)
  } catch (err) {
    console.error(
      `[system_event] falha ao gravar evento: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Evita spam de notificação: retorna true se NÃO houve evento igual
 * (mesmo event_type + unidade) nas últimas `windowHours` horas.
 * Em caso de erro na consulta, retorna false (não notifica) para não
 * arriscar uma tempestade de e-mails.
 */
export async function shouldNotifyForEvent(
  supabase: SupabaseClient,
  params: { eventType: string; unitId?: string | null; windowHours?: number },
): Promise<boolean> {
  const windowStart = new Date(Date.now() - (params.windowHours ?? 6) * 60 * 60 * 1000).toISOString()

  try {
    let query = supabase
      .from('system_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', params.eventType)
      .gte('created_at', windowStart)

    if (params.unitId) query = query.eq('unit_id', params.unitId)

    const { count, error } = await query
    if (error) return false
    return (count ?? 0) === 0
  } catch {
    return false
  }
}
