import type { SupabaseClient } from '@supabase/supabase-js'

type EventRow = {
  id: string
  org_id: string | null
  unit_id: string | null
  source: string
  event_type: string
  message: string
  created_at: string
}

type AgentConfigRow = {
  id: string
  unit_id: string
  agent_type: string
  certification_status: string
  unit: { org_id: string } | { org_id: string }[] | null
}

const PRIORITY_BY_EVENT: Record<string, 'high' | 'critical'> = {
  payment_charge_failed: 'critical',
  pending_signup_provision_failed: 'critical',
  whatsapp_webhook_processing_failed: 'high',
  whatsapp_webhook_configure_failed: 'critical',
  audio_transcription_failed: 'high',
  audio_media_download_failed: 'high',
  image_analysis_failed: 'high',
  image_media_download_failed: 'high',
  prospecting_failed: 'high',
}

export async function runKaiSupervisor(supabase: SupabaseClient, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('system_events')
    .select('id,org_id,unit_id,source,event_type,message,created_at')
    .in('level', ['warning', 'error'])
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(500)
  if (error) throw new Error(`Não foi possível ler eventos para a Kai: ${error.message}`)

  const events = (data ?? []) as EventRow[]
  const tasks = events
    .filter((event) => Boolean(PRIORITY_BY_EVENT[event.event_type]))
    .map((event) => ({
      org_id: event.org_id,
      unit_id: event.unit_id,
      source_event_id: event.id,
      kind: event.event_type,
      title: `Falha em ${event.source}: ${event.event_type}`,
      description: event.message,
      priority: PRIORITY_BY_EVENT[event.event_type],
      owner: 'kai',
      due_at: new Date(now.getTime() + (PRIORITY_BY_EVENT[event.event_type] === 'critical' ? 15 : 60) * 60 * 1000).toISOString(),
      dedupe_key: `system_event:${event.id}`,
      metadata: { source: event.source, observed_at: event.created_at },
    }))

  const { data: uncertifiedData, error: uncertifiedError } = await supabase
    .from('agent_configs')
    .select('id,unit_id,agent_type,certification_status,unit:units(org_id)')
    .eq('is_active', true)
    .in('certification_status', ['missing_information', 'requires_review'])
    .limit(500)
  if (uncertifiedError) throw new Error(`Não foi possível verificar certificações: ${uncertifiedError.message}`)

  const certificationTasks = ((uncertifiedData ?? []) as unknown as AgentConfigRow[]).map((config) => ({
    org_id: (Array.isArray(config.unit) ? config.unit[0]?.org_id : config.unit?.org_id) ?? null,
    unit_id: config.unit_id,
    source_event_id: null,
    kind: 'agent_certification_required',
    title: `Funcionário ${config.agent_type} requer certificação`,
    description: 'Revise o treinamento e aprove os cenários antes do lançamento. O atendimento legado não foi interrompido automaticamente.',
    status: 'waiting_human',
    priority: 'critical' as const,
    owner: 'kai',
    due_at: now.toISOString(),
    dedupe_key: `agent_certification:${config.id}`,
    metadata: {
      agent_config_id: config.id,
      agent_type: config.agent_type,
      certification_status: config.certification_status,
    },
  }))

  const allTasks = [...tasks, ...certificationTasks]
  if (allTasks.length === 0) return { scanned: events.length, uncertified: 0, created: 0 }
  const { data: inserted, error: insertError } = await supabase
    .from('kai_tasks')
    .upsert(allTasks, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select('id')
  if (insertError) throw new Error(`Não foi possível registrar tarefas da Kai: ${insertError.message}`)
  return { scanned: events.length, uncertified: certificationTasks.length, created: inserted?.length ?? 0 }
}
