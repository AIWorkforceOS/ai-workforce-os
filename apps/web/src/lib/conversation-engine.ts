import type { SupabaseClient } from '@supabase/supabase-js'
import { getEvolutionConfig, sendWhatsAppMessage } from '@/lib/evolution'
import { generateChatReply, getOpenAIApiKey, type ChatMessage } from '@/lib/openai'
import { sendEscalationEmail, sendTechnicalAlertEmail } from '@/lib/email'
import { logSystemEvent, shouldNotifyForEvent, type SystemEventSource } from '@/lib/system-events'
import type { AgentConfig, AgentTone, Conversation, Lead, Unit, ActiveHours } from '@/lib/types'

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export function isWithinActiveHours(activeHours: ActiveHours, timeZone = 'America/Sao_Paulo'): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const weekday = WEEKDAY_MAP[parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'] ?? 0
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const currentMinutes = hour * 60 + minute

  const [startH = 0, startM = 0] = activeHours.start.split(':').map(Number)
  const [endH = 23, endM = 59] = activeHours.end.split(':').map(Number)

  return (
    activeHours.days.includes(weekday) &&
    currentMinutes >= startH * 60 + startM &&
    currentMinutes <= endH * 60 + endM
  )
}

const TONE_LABEL: Record<AgentTone, string> = {
  professional: 'profissional e direto',
  friendly: 'amigável e caloroso',
  formal: 'formal e cortês',
}

function buildSystemPrompt(agentConfig: AgentConfig, unit: Unit): string {
  return [
    `Você é ${agentConfig.persona_name}, um agente de SDR (pré-vendas) que atende pelo WhatsApp em nome da unidade ${unit.name}${unit.region_city ? ` (${unit.region_city})` : ''}.`,
    `Seu tom de comunicação deve ser ${TONE_LABEL[agentConfig.persona_tone]}.`,
    'Seu objetivo é qualificar o lead e conseguir agendar uma conversa com um vendedor humano.',
    'Responda sempre em português do Brasil, de forma breve (no máximo 3 frases curtas), sem usar markdown ou listas.',
  ].join(' ')
}

export async function countSentToday(supabase: SupabaseClient, unitId: string): Promise<number> {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const { count } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('unit_id', unitId)
    .eq('direction', 'outbound')
    .gte('sent_at', startOfDay.toISOString())

  return count ?? 0
}

export async function generateFirstContactMessage(
  agentConfig: AgentConfig,
  unit: Unit,
  lead: Lead,
): Promise<string> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não está configurada.')

  const systemPrompt = [
    buildSystemPrompt(agentConfig, unit),
    `Escreva a mensagem de primeiro contato para a empresa "${lead.company_name}"${lead.sector ? `, do setor de ${lead.sector}` : ''}.`,
    'Apresente-se, explique brevemente o motivo do contato e pergunte se pode compartilhar mais informações.',
  ].join(' ')

  return generateChatReply({
    apiKey,
    systemPrompt,
    history: [{ role: 'user', content: 'Inicie a conversa com este lead.' }],
  })
}

export async function generateFollowUpMessage(
  agentConfig: AgentConfig,
  unit: Unit,
  lead: Lead,
  history: Conversation[],
): Promise<string> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não está configurada.')

  const systemPrompt = [
    buildSystemPrompt(agentConfig, unit),
    `A empresa "${lead.company_name}" está sem responder há alguns dias.`,
    'Escreva UMA mensagem curta de follow-up: retome o assunto da conversa com leveza, sem pressionar, e termine com uma pergunta simples que facilite a resposta.',
    'Não repita a mensagem anterior nem peça desculpas por insistir.',
  ].join(' ')

  const chatHistory: ChatMessage[] = history.map((row) => ({
    role: row.direction === 'inbound' ? 'user' : 'assistant',
    content: row.content,
  }))
  chatHistory.push({ role: 'user', content: 'Gere a mensagem de follow-up para este lead.' })

  return generateChatReply({ apiKey, systemPrompt, history: chatHistory })
}

async function findEscalationReason(
  incomingText: string,
  agentConfig: AgentConfig,
  messageCount: number,
): Promise<string | null> {
  const keywords = agentConfig.escalation_rules?.keywords ?? []
  const matched = keywords.find((keyword) =>
    incomingText.toLowerCase().includes(keyword.toLowerCase()),
  )
  if (matched) return `palavra-chave de escalação detectada ("${matched}")`

  const afterMessages = agentConfig.escalation_rules?.after_messages
  if (afterMessages && messageCount >= afterMessages) {
    return `limite de ${afterMessages} mensagens na conversa atingido`
  }

  return null
}

async function reportAgentFailure(params: {
  supabase: SupabaseClient
  unit: Unit
  lead: Lead
  source: SystemEventSource
  eventType: string
  message: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { supabase, unit, lead, source, eventType, message, metadata } = params

  await logSystemEvent(supabase, {
    level: 'error',
    source,
    eventType,
    message,
    orgId: unit.org_id,
    unitId: unit.id,
    leadId: lead.id,
    metadata,
  })

  // Notifica o responsável por e-mail, com janela anti-spam de 6h por tipo de falha/unidade
  const notify = await shouldNotifyForEvent(supabase, { eventType, unitId: unit.id })
  if (!notify || !unit.org_id) return

  const { data: org } = await supabase
    .from('organizations')
    .select('owner_email')
    .eq('id', unit.org_id)
    .maybeSingle()

  const ownerEmail = (org as { owner_email: string | null } | null)?.owner_email
  if (ownerEmail) {
    await sendTechnicalAlertEmail({
      to: ownerEmail,
      unitName: unit.name,
      problem: message,
      impact: `O lead "${lead.company_name}" enviou uma mensagem e não recebeu resposta automática.`,
    })
  }
}

export async function processInboundMessage(params: {
  supabase: SupabaseClient
  unit: Unit
  lead: Lead
  incomingText: string
}): Promise<void> {
  const { supabase, unit, lead, incomingText } = params

  const { data: agentConfig } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('agent_type', 'sdr')
    .maybeSingle()

  const config = agentConfig as AgentConfig | null
  if (!config || !config.is_active) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'system',
      eventType: 'agent_not_configured',
      message: `Mensagem recebida na unidade "${unit.name}" mas o agente SDR está ${config ? 'inativo' : 'sem configuração'} — nenhuma resposta enviada.`,
      orgId: unit.org_id,
      unitId: unit.id,
      leadId: lead.id,
    })
    return
  }

  // Fora do horário ativo ou acima do limite diário são comportamentos
  // esperados (configurados pelo cliente) — não geram evento de erro.
  if (!isWithinActiveHours(config.active_hours)) return

  const sentToday = await countSentToday(supabase, unit.id)
  if (sentToday >= config.daily_limit) return

  const { data: history } = await supabase
    .from('conversations')
    .select('*')
    .eq('lead_id', lead.id)
    .order('sent_at', { ascending: true })
    .limit(20)

  const historyRows = (history as Conversation[] | null) ?? []

  const escalationReason = await findEscalationReason(
    incomingText,
    config,
    historyRows.length + 1,
  )

  if (escalationReason) {
    const { data: org } = await supabase
      .from('organizations')
      .select('owner_email')
      .eq('id', unit.org_id)
      .maybeSingle()

    const ownerEmail = (org as { owner_email: string | null } | null)?.owner_email
    if (ownerEmail) {
      const result = await sendEscalationEmail({
        to: ownerEmail,
        unitName: unit.name,
        leadName: lead.company_name,
        leadPhone: lead.phone,
        reason: escalationReason,
        lastMessage: incomingText,
      })
      if (!result.ok) {
        await logSystemEvent(supabase, {
          level: 'error',
          source: 'resend',
          eventType: 'escalation_email_failed',
          message: `Conversa escalada para humano mas o e-mail de aviso falhou: ${result.error ?? 'erro desconhecido'}`,
          orgId: unit.org_id,
          unitId: unit.id,
          leadId: lead.id,
        })
      }
    } else {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'system',
        eventType: 'escalation_without_email',
        message: `Conversa do lead "${lead.company_name}" escalada (${escalationReason}), mas a organização não tem owner_email para ser avisada.`,
        orgId: unit.org_id,
        unitId: unit.id,
        leadId: lead.id,
      })
    }
    return
  }

  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    await reportAgentFailure({
      supabase,
      unit,
      lead,
      source: 'openai',
      eventType: 'missing_env_openai',
      message: 'OPENAI_API_KEY não está configurada — o agente SDR não consegue gerar respostas.',
    })
    return
  }

  const evolutionConfig = getEvolutionConfig(unit)
  if (!evolutionConfig) {
    await reportAgentFailure({
      supabase,
      unit,
      lead,
      source: 'evolution',
      eventType: 'missing_env_evolution',
      message: `Evolution API não configurada para a unidade "${unit.name}" — o agente não consegue enviar mensagens no WhatsApp.`,
    })
    return
  }

  const chatHistory: ChatMessage[] = historyRows.map((row) => ({
    role: row.direction === 'inbound' ? 'user' : 'assistant',
    content: row.content,
  }))
  chatHistory.push({ role: 'user', content: incomingText })

  let reply: string
  try {
    reply = await generateChatReply({
      apiKey,
      systemPrompt: buildSystemPrompt(config, unit),
      history: chatHistory,
    })
  } catch (error) {
    await reportAgentFailure({
      supabase,
      unit,
      lead,
      source: 'openai',
      eventType: 'openai_api_error',
      message: `Falha na OpenAI ao gerar resposta: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
    })
    return
  }

  if (!reply) return

  if (!lead.phone) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'system',
      eventType: 'lead_without_phone',
      message: `Lead "${lead.company_name}" respondeu mas não tem telefone cadastrado — resposta não enviada.`,
      orgId: unit.org_id,
      unitId: unit.id,
      leadId: lead.id,
    })
    return
  }

  try {
    await sendWhatsAppMessage(evolutionConfig, lead.phone, reply)
  } catch (error) {
    // Registra a resposta que falhou no histórico (status 'failed') para
    // que a falha fique visível na tela de Conversas, não só no log.
    await supabase.from('conversations').insert({
      lead_id: lead.id,
      unit_id: unit.id,
      channel: 'whatsapp',
      direction: 'outbound',
      content: reply,
      status: 'failed',
      sent_at: new Date().toISOString(),
    })

    await reportAgentFailure({
      supabase,
      unit,
      lead,
      source: 'evolution',
      eventType: 'evolution_send_failed',
      message: `Falha ao enviar resposta via Evolution API: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
    })
    return
  }

  const sentAt = new Date().toISOString()

  await supabase.from('conversations').insert({
    lead_id: lead.id,
    unit_id: unit.id,
    channel: 'whatsapp',
    direction: 'outbound',
    content: reply,
    status: 'sent',
    sent_at: sentAt,
  })

  await supabase.from('leads').update({ last_contacted_at: sentAt }).eq('id', lead.id)
}
