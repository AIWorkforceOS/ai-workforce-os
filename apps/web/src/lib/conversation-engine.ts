import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getMessagingChannel,
  getUnitChannelType,
  channelLabel,
  sendToLeadChannels,
  type ChannelSendAttempt,
} from '@/lib/channels/messaging-channel'
import { conversationLanguageDirective, unitDefaultLocale } from '@/lib/i18n/config'
import { generateChatReply, generateStructuredReply, getOpenAIApiKey, type ChatMessage } from '@/lib/openai'
import { sendEscalationEmail, sendTechnicalAlertEmail } from '@/lib/email'
import { logSystemEvent, shouldNotifyForEvent, type SystemEventSource } from '@/lib/system-events'
import { syncLeadToSmarterCrm } from '@/lib/sales/smarter-crm'
import { IDENTITY_AND_HANDOFF_RULES } from '@/lib/agent-identity'
import { buildTrainingCorrectionsContext } from '@/lib/agent-training'
import { buildCombinedBusinessContext } from '@/lib/interview/engine'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { fetchActiveAttachments, buildAttachmentsContext } from '@/lib/attachments'
import type { AgentConfig, AgentTone, Conversation, Lead, Unit, ActiveHours, EmployeeAttachment } from '@/lib/types'

// Dados levantados pelo Sales Rep (AI) direto na conversa quando o
// cliente confirma um fechamento de verdade. As chaves não são fixas:
// são EXATAMENTE as que a empresa ensinou na sua entrevista de
// contratação (`business_profile.fechamento_campos` — ver
// lib/interview/engine.ts), porque o que precisa ser perguntado no
// fechamento varia por negócio (vaga de recrutamento, dados de
// contrato de franquia, ou qualquer outra coisa específica daquela
// empresa) — ver lib/sales/deal-handoff.ts para o que acontece depois.
export type SalesDealProfile = Record<string, unknown>

export type ClosingField = { chave: string; pergunta: string }

/** Lê os campos de fechamento ensinados na entrevista (lista vazia = nada a perguntar, só confirmar). */
export function closingFields(businessProfile: Record<string, unknown>): ClosingField[] {
  const raw = businessProfile.fechamento_campos
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (typeof item !== 'object' || item === null) return null
      const chave = String((item as Record<string, unknown>).chave ?? '').trim()
      const pergunta = String((item as Record<string, unknown>).pergunta ?? '').trim()
      return chave.length > 0 ? { chave, pergunta: pergunta || chave } : null
    })
    .filter((f): f is ClosingField => f !== null)
}

function isDealProfileComplete(fields: ClosingField[], profile: SalesDealProfile): boolean {
  return fields.every((f) => {
    const value = profile[f.chave]
    return value !== null && value !== undefined && value !== ('' as unknown)
  })
}

function missingDealFieldLabels(fields: ClosingField[], profile: SalesDealProfile): string[] {
  return fields
    .filter((f) => {
      const value = profile[f.chave]
      return value === null || value === undefined || value === ('' as unknown)
    })
    .map((f) => f.pergunta)
}

function mergeDealProfile(current: SalesDealProfile, updates: SalesDealProfile | undefined): SalesDealProfile {
  const merged: SalesDealProfile = { ...current }
  for (const [key, value] of Object.entries(updates ?? {})) {
    if (value === null || value === undefined || value === '') continue
    merged[key] = value
  }
  return merged
}

type DealExtractionOutput = {
  deal_confirmed?: boolean
  deal_profile_updates?: Record<string, unknown>
}

/**
 * Prompt único de extração de fechamento: decide se o cliente confirmou
 * o fechamento e, quando a empresa ensinou campos para coletar nesse
 * momento (`fields`, aprendidos na entrevista), extrai SOMENTE esses —
 * nunca um formato fixo de "vaga", que só faz sentido quando foi isso
 * que a empresa ensinou.
 */
function buildDealExtractorPrompt(fields: ClosingField[], currentDeal: SalesDealProfile): string {
  if (fields.length === 0) {
    return [
      'Você está analisando a ÚLTIMA mensagem de um cliente numa conversa de vendas pelo WhatsApp para decidir se ele acabou de confirmar o FECHAMENTO de um negócio de verdade (quer comprar/contratar/seguir em frente agora — intenção vaga como "vou pensar" ou "depois eu vejo" NÃO conta como fechamento).',
      'Responda SOMENTE um JSON válido: {"deal_confirmed": boolean}.',
    ].join(' ')
  }

  const fieldsList = fields.map((f) => `"${f.chave}" (${f.pergunta})`).join(', ')
  const jsonShape = fields.map((f) => `"${f.chave}": string|number|null`).join(', ')

  return [
    'Você está analisando a ÚLTIMA mensagem de um cliente numa conversa de vendas pelo WhatsApp para decidir se ele acabou de confirmar o FECHAMENTO de um negócio de verdade (quer contratar/comprar/seguir em frente agora — intenção vaga como "vou pensar" ou "depois eu vejo" NÃO conta como fechamento) e, se sim, extrair os dados que a empresa ensinou que precisam ser coletados nesse momento.',
    `Dados já coletados sobre este fechamento até agora: ${JSON.stringify(currentDeal)}.`,
    `Extraia SOMENTE estes campos, exatamente com estas chaves, e SOMENTE o que a última mensagem do cliente trouxe de novo (não repita o que já estava coletado): ${fieldsList}.`,
    `Responda SOMENTE um JSON válido: {"deal_confirmed": boolean, "deal_profile_updates": {${jsonShape}}}.`,
    'Não invente valores nem preencha campos fora dessa lista: use null para o que não foi dito nesta mensagem.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Se o fechamento ensinado nesta configuração (`business_profile`)
 * significa especificamente "criar uma vaga de recrutamento/estágio e
 * mandar pro Recrutador" — a ÚNICA automação de handoff que existe hoje
 * (ver lib/sales/deal-handoff.ts). Aprendido na entrevista via
 * `fechamento_cria_vaga_recrutamento` (lib/interview/engine.ts); sem
 * automação ensinada, o fechamento só fica registrado para o time
 * humano agir manualmente.
 */
export function isAutoRecruitmentDeal(businessProfile: Record<string, unknown>): boolean {
  return businessProfile.fechamento_cria_vaga_recrutamento === true
}

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

// Técnica de vendas real (item 1 do pedido do produto): o Sales Rep (AI)
// precisa se comportar como o melhor especialista em vendas do mercado,
// não como um FAQ de produto. Estas regras são genéricas de técnica
// comercial e PNL — os argumentos concretos (produtos, preços,
// diferenciais) sempre vêm da ficha da empresa (business_profile),
// nunca são inventados aqui.
const SALES_EXPERTISE_RULES = [
  'TÉCNICA DE VENDAS: você é o melhor especialista em vendas do mercado, com domínio real de técnicas comerciais e PNL — aplique-as com naturalidade na conversa, nunca de forma decorada ou robótica.',
  'Pratique escuta ativa: deixe o cliente falar, faça perguntas abertas e demonstre que entendeu antes de responder.',
  'Use espelhamento e rapport: adapte seu ritmo e vocabulário ao jeito de falar do cliente para criar conexão genuína.',
  'Identifique a dor real do cliente ANTES de apresentar qualquer solução — nunca empurre produto sem antes entender o problema.',
  'Ancore o valor (benefícios e resultado) antes de falar preço; quando o preço aparecer, relacione-o sempre ao valor entregue, nunca isoladamente.',
  'Trate objeções com naturalidade, sem se justificar demais: em "é caro" reforce o retorno/valor; em "vou pensar" identifique a dúvida real por trás disso e proponha um próximo passo concreto; em "não é prioridade agora" mostre o custo de adiar; diante de concorrência, destaque diferenciais reais sem falar mal de ninguém.',
  'Use gatilhos de urgência e escassez COM ÉTICA — só quando forem verdadeiros; nunca minta sobre estoque, vagas ou prazos que não existem.',
  'Ao reabrir uma conversa fria/parada, nunca comece só com "oi, tudo bem?" — retome com um ângulo novo (uma novidade, um benefício ainda não explorado, ou uma pergunta que reconecte com a dor do cliente).',
].join(' ')

/**
 * Aplicada só quando a empresa NÃO configurou nenhum material na
 * biblioteca de anexos desta unidade (migration 036) — com materiais
 * configurados, a regra é o oposto (ver buildAttachmentsContext em
 * lib/attachments.ts, injetado no lugar desta linha).
 */
const NO_ATTACHMENTS_RULE =
  'Se o cliente pedir uma apresentação, catálogo, portfólio ou material sobre o negócio: você NÃO tem como enviar arquivos, então nunca prometa mandar um documento. Em vez disso, resuma ali mesmo na conversa, em poucas frases: a dor/problema do cliente, o que o produto/serviço resolve, e a vantagem concreta de fechar agora — sempre usando o que você aprendeu sobre a empresa.'

export function buildSystemPrompt(
  agentConfig: AgentConfig,
  unit: Unit,
  dealProfile?: SalesDealProfile,
  organizationProfile?: Record<string, unknown> | null,
  /** Contexto da biblioteca de anexos (lib/attachments.ts) — vazio/omitido = sem materiais configurados, aplica NO_ATTACHMENTS_RULE. */
  attachmentsContext?: string,
): string {
  const businessContext = buildCombinedBusinessContext(organizationProfile, agentConfig.business_profile)
  const trainingCorrectionsContext = buildTrainingCorrectionsContext(agentConfig.training_corrections)
  const profile = (agentConfig.business_profile ?? {}) as Record<string, unknown>
  const closesAlone = profile.fechamento === 'fecha_sozinho'
  const channelType = getUnitChannelType(unit)
  const locale = unitDefaultLocale(unit)
  const fields = closingFields(profile)
  const dealAction =
    typeof profile.fechamento_acao === 'string' && profile.fechamento_acao.trim()
      ? profile.fechamento_acao.trim()
      : null

  const dealSection = closesAlone
    ? [
        'FECHAMENTO DE NEGÓCIO: quando o cliente confirmar que quer fechar de verdade (contratar/comprar/seguir agora, não apenas demonstrar interesse), aja ESTRITAMENTE conforme foi ensinado pela empresa para este momento — nunca peça dados nem ofereça/prometa ações que não fazem parte do que foi ensinado nesta configuração, mesmo que pareçam fazer sentido em outros negócios.',
        fields.length > 0
          ? [
              `Dados que você precisa perguntar nesse momento (SOMENTE estes, nada além disso): ${fields.map((f) => f.pergunta).join('; ')}. No máximo 2 perguntas por mensagem.`,
              dealProfile && Object.keys(dealProfile).length > 0
                ? `Dados já coletados sobre este fechamento: ${JSON.stringify(dealProfile)}. Pergunte só o que ainda falta: ${missingDealFieldLabels(fields, dealProfile).join(', ') || 'nada, já está completo'}.`
                : '',
            ]
              .filter(Boolean)
              .join(' ')
          : 'A empresa não ensinou nenhum dado específico para coletar neste momento — apenas confirme o fechamento com entusiasmo e reforce o valor da decisão.',
        dealAction ? `O que deve acontecer depois de coletar os dados: ${dealAction}.` : '',
        'Assim que tiver os dados (se houver), avise o cliente que vai passar a finalização para o setor responsável e que alguém dará continuidade — não prometa prazos exatos nem detalhes que você não sabe.',
      ]
        .filter(Boolean)
        .join(' ')
    : ''

  return [
    `Você é ${agentConfig.persona_name}, um AI Sales Representative (pré-vendas) que atende por ${channelLabel(channelType)} em nome da unidade ${unit.name}${unit.region_city ? ` (${unit.region_city})` : ''}.`,
    `Seu tom de comunicação deve ser ${TONE_LABEL[agentConfig.persona_tone]}.`,
    closesAlone
      ? 'Seu objetivo é qualificar o lead e conduzir a venda até o fechamento, conforme combinado com a empresa.'
      : 'Seu objetivo é qualificar o lead e conseguir agendar uma conversa com um vendedor humano.',
    channelType === 'sms'
      ? 'Responda sempre de forma breve (no máximo 1-2 frases curtas, idealmente até 160 caracteres), sem usar markdown ou listas — cada mensagem é um SMS, e mensagens longas viram vários SMS e custam mais.'
      : 'Responda sempre de forma breve (no máximo 3 frases curtas), sem usar markdown ou listas.',
    conversationLanguageDirective(locale),
    IDENTITY_AND_HANDOFF_RULES,
    SALES_EXPERTISE_RULES,
    attachmentsContext || NO_ATTACHMENTS_RULE,
    ...(businessContext
      ? [
          businessContext,
          'Responda dúvidas sobre produtos, preços e condições usando somente a ficha acima. Nunca ofereça desconto além da política de desconto registrada, e respeite o combinado sobre até onde você conduz a venda.',
        ]
      : []),
    trainingCorrectionsContext ?? '',
    dealSection,
  ]
    .filter(Boolean)
    .join(' ')
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

export type SendAcrossChannelsResult = { anySent: boolean; attempts: ChannelSendAttempt[] }

/**
 * Manda a mesma mensagem por todos os canais disponíveis para o lead
 * (WhatsApp/SMS se tem telefone, e-mail se tem e-mail — item 2 do
 * pedido) e grava uma linha em `conversations` por tentativa, todas com
 * o mesmo `lead_id`. É isso que mantém o histórico consolidado: um lead
 * com telefone e e-mail continua sendo UM lead com UMA conversa, só que
 * com mensagens em mais de um canal, nunca dois leads desconectados.
 *
 * Usado nos disparos proativos (primeiro contato, follow-up automático):
 * nesses casos vale tentar os dois canais porque ainda não se sabe qual
 * vai emplacar. Respostas a mensagens recebidas (processInboundMessage)
 * continuam indo só pelo canal em que o lead respondeu — não há como
 * ingerir resposta de e-mail hoje (sem webhook de e-mail configurado),
 * então duplicar a resposta por e-mail a cada turno só gera ruído.
 */
export async function sendAcrossChannels(params: {
  supabase: SupabaseClient
  unit: Unit
  lead: Pick<Lead, 'id' | 'phone' | 'email'>
  text: string
  subject?: string
  personaName?: string
  templateKey?: string | null
}): Promise<SendAcrossChannelsResult> {
  const attempts = await sendToLeadChannels({
    unit: params.unit,
    lead: params.lead,
    text: params.text,
    context: { subject: params.subject, personaName: params.personaName },
  })

  const sentAt = new Date().toISOString()
  for (const attempt of attempts) {
    await params.supabase.from('conversations').insert({
      lead_id: params.lead.id,
      unit_id: params.unit.id,
      channel: attempt.channel,
      direction: 'outbound',
      content: params.text,
      template_key: params.templateKey ?? null,
      status: attempt.ok ? 'sent' : 'failed',
      sent_at: sentAt,
    })
  }

  return { anySent: attempts.some((a) => a.ok), attempts }
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

export type ProcessInboundResult = { dealHandoffReady: boolean }

export async function processInboundMessage(params: {
  supabase: SupabaseClient
  unit: Unit
  lead: Lead
  incomingText: string
  /** Cliente mandou a mensagem por áudio → resposta também deve ser em áudio (item 1 do pedido de voz). */
  wasAudioMessage?: boolean
}): Promise<ProcessInboundResult> {
  const { supabase, unit, lead, incomingText, wasAudioMessage } = params
  const noHandoff: ProcessInboundResult = { dealHandoffReady: false }

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
      message: `Mensagem recebida na unidade "${unit.name}" mas o AI Sales Representative está ${config ? 'inativo' : 'sem configuração'} — nenhuma resposta enviada.`,
      orgId: unit.org_id,
      unitId: unit.id,
      leadId: lead.id,
    })
    return noHandoff
  }

  // Fora do horário ativo ou acima do limite diário são comportamentos
  // esperados (configurados pelo cliente) — não geram evento de erro.
  if (!isWithinActiveHours(config.active_hours)) return noHandoff

  const sentToday = await countSentToday(supabase, unit.id)
  if (sentToday >= config.daily_limit) return noHandoff

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
    return noHandoff
  }

  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    await reportAgentFailure({
      supabase,
      unit,
      lead,
      source: 'openai',
      eventType: 'missing_env_openai',
      message: 'OPENAI_API_KEY não está configurada — o AI Sales Representative não consegue gerar respostas.',
    })
    return noHandoff
  }

  const channelType = getUnitChannelType(unit)
  const channel = getMessagingChannel(unit, supabase)
  if (!channel) {
    await reportAgentFailure({
      supabase,
      unit,
      lead,
      source: channelType === 'sms' ? 'twilio' : 'evolution',
      eventType: channelType === 'sms' ? 'missing_env_twilio' : 'missing_env_evolution',
      message: `${channelType === 'sms' ? 'Twilio' : 'Evolution API'} não configurada para a unidade "${unit.name}" — o agente não consegue enviar mensagens no ${channelLabel(channelType)}.`,
    })
    return noHandoff
  }

  // Fechamento de negócio (item 2): só faz sentido levantar dados de
  // fechamento quando o próprio agente conduz a venda até o fim
  // (fecha_sozinho) e o lead ainda não fechou — se ele só qualifica e
  // passa para um humano, o fechamento real acontece fora da conversa e
  // este agente não tem como observá-lo. Os campos a perguntar (`fields`)
  // são EXATAMENTE os ensinados na entrevista para esta configuração —
  // nunca um formato fixo (ver closingFields em lib/conversation-engine.ts).
  const businessProfile = (config.business_profile ?? {}) as Record<string, unknown>
  const closesAlone = businessProfile.fechamento === 'fecha_sozinho'
  const fields = closingFields(businessProfile)
  let dealProfile = (lead.deal_profile ?? {}) as SalesDealProfile
  let dealConfirmedThisTurn = false

  if (closesAlone && !lead.deal_closed_at) {
    try {
      const extraction = await generateStructuredReply<DealExtractionOutput>({
        apiKey,
        systemPrompt: buildDealExtractorPrompt(fields, dealProfile),
        history: [{ role: 'user', content: incomingText }],
        maxTokens: fields.length > 0 ? 500 : 200,
      })
      if (fields.length > 0) dealProfile = mergeDealProfile(dealProfile, extraction.deal_profile_updates)
      dealConfirmedThisTurn = extraction.deal_confirmed === true
    } catch (error) {
      // Extração é best-effort: uma falha aqui não pode travar a resposta ao cliente.
      console.error(
        `[conversation_engine] extração de fechamento falhou: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const chatHistory: ChatMessage[] = historyRows.map((row) => ({
    role: row.direction === 'inbound' ? 'user' : 'assistant',
    content: row.content,
  }))
  chatHistory.push({ role: 'user', content: incomingText })

  // Ficha da Empresa compartilhada entre todos os funcionários digitais
  // (organizations.business_profile, migration 025) — soma-se à ficha
  // específica deste Sales Rep sem substituí-la (buildCombinedBusinessContext).
  const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unit.org_id)

  // Biblioteca de anexos deste funcionário (migration 036). Só quando há
  // pelo menos um material ativo é que a resposta passa a sair em JSON
  // (schema com attachment_id) — sem nenhum configurado, mantém o caminho
  // de texto puro de sempre (generateChatReply), sem custo/risco extra.
  const attachments = await fetchActiveAttachments(supabase, unit.id, 'sdr')
  const attachmentsContext = buildAttachmentsContext(attachments)

  let reply: string
  let chosenAttachment: EmployeeAttachment | null = null
  try {
    if (attachments.length > 0) {
      const structured = await generateStructuredReply<{ reply?: string; attachment_id?: string | null }>({
        apiKey,
        systemPrompt: [
          buildSystemPrompt(config, unit, dealProfile, organizationProfile, attachmentsContext),
          'Responda SOMENTE um JSON válido: {"reply": string, "attachment_id": string|null}. O campo "reply" é a mensagem normal que você mandaria ao cliente, seguindo à risca todas as regras de tom, tamanho e idioma já combinadas acima. O campo "attachment_id" é o id do material a enviar agora (ver MATERIAIS DISPONÍVEIS PARA ENVIAR acima), ou null se nenhum se aplica a esta mensagem.',
        ].join(' '),
        history: chatHistory,
        // Preserva o tom conversacional de generateChatReply (0.7) — o
        // default 0.2 de generateStructuredReply é pensado pra extractors
        // determinísticos, não pra esta resposta que o cliente vai ler.
        temperature: 0.7,
      })
      reply = (structured.reply ?? '').trim()
      const attachmentId = structured.attachment_id ?? null
      chosenAttachment = attachmentId ? attachments.find((a) => a.id === attachmentId) ?? null : null
    } else {
      reply = await generateChatReply({
        apiKey,
        systemPrompt: buildSystemPrompt(config, unit, dealProfile, organizationProfile),
        history: chatHistory,
      })
    }
  } catch (error) {
    await reportAgentFailure({
      supabase,
      unit,
      lead,
      source: 'openai',
      eventType: 'openai_api_error',
      message: `Falha na OpenAI ao gerar resposta: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
    })
    return noHandoff
  }

  if (!reply) return noHandoff

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
    return noHandoff
  }

  // Anexo escolhido pelo modelo (se algum): links (e PDFs no SMS, que não
  // segura arquivo real) sempre viram URL embutida no próprio texto; PDFs
  // em WhatsApp/e-mail viram um anexo de verdade, enviado pelo canal.
  let outgoingText = reply
  let attachmentPayload: { title: string; url: string; fileName?: string | null } | undefined
  if (chosenAttachment) {
    if (chosenAttachment.kind === 'link' || channelType === 'sms') {
      outgoingText = `${reply}\n\n${chosenAttachment.title}: ${chosenAttachment.file_url}`
    } else {
      attachmentPayload = {
        title: chosenAttachment.title,
        url: chosenAttachment.file_url,
        fileName: chosenAttachment.file_name,
      }
    }
  }

  try {
    await channel.sendMessage(lead.phone, outgoingText, { voiceReply: wasAudioMessage, attachment: attachmentPayload })
  } catch (error) {
    // Registra a resposta que falhou no histórico (status 'failed') para
    // que a falha fique visível na tela de Conversas, não só no log.
    await supabase.from('conversations').insert({
      lead_id: lead.id,
      unit_id: unit.id,
      channel: channelType,
      direction: 'outbound',
      content: outgoingText,
      status: 'failed',
      sent_at: new Date().toISOString(),
    })

    await reportAgentFailure({
      supabase,
      unit,
      lead,
      source: channelType === 'sms' ? 'twilio' : 'evolution',
      eventType: channelType === 'sms' ? 'twilio_send_failed' : 'evolution_send_failed',
      message: `Falha ao enviar resposta via ${channelLabel(channelType)}: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
    })
    return noHandoff
  }

  const sentAt = new Date().toISOString()

  await supabase.from('conversations').insert({
    lead_id: lead.id,
    unit_id: unit.id,
    channel: channelType,
    direction: 'outbound',
    content: outgoingText,
    status: 'sent',
    sent_at: sentAt,
  })

  // Só fecha quando todos os campos ensinados para este fechamento
  // estiverem coletados (lista vazia = nada ensinado para perguntar, então
  // basta a confirmação).
  const readyToClose =
    closesAlone && !lead.deal_closed_at && dealConfirmedThisTurn && isDealProfileComplete(fields, dealProfile)

  const leadUpdate: Record<string, unknown> = { last_contacted_at: sentAt }
  if (closesAlone && !lead.deal_closed_at) {
    if (fields.length > 0) leadUpdate.deal_profile = dealProfile
    if (readyToClose) {
      leadUpdate.status = 'won'
      leadUpdate.deal_closed_at = sentAt
    }
  }
  await supabase.from('leads').update(leadUpdate).eq('id', lead.id)

  if ('status' in leadUpdate) {
    await syncLeadToSmarterCrm(supabase, unit, { ...lead, ...leadUpdate } as Lead, { statusChanged: true })
  }

  return { dealHandoffReady: readyToClose }
}
