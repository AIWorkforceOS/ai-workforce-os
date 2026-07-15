import type { SupabaseClient } from '@supabase/supabase-js'
import { getEvolutionConfig, sendWhatsAppMessage } from '@/lib/evolution'
import { generateChatReply, generateStructuredReply, getOpenAIApiKey, type ChatMessage } from '@/lib/openai'
import { sendEscalationEmail, sendTechnicalAlertEmail } from '@/lib/email'
import { logSystemEvent, shouldNotifyForEvent, type SystemEventSource } from '@/lib/system-events'
import { IDENTITY_AND_HANDOFF_RULES } from '@/lib/agent-identity'
import { buildBusinessContext } from '@/lib/interview/engine'
import type { AgentConfig, AgentTone, Conversation, Lead, Unit, ActiveHours } from '@/lib/types'

// Perfil de vaga levantado pelo Sales Rep (AI) direto na conversa quando
// o cliente confirma um fechamento de verdade — mesmos campos que o
// intake do Recrutador usaria, sem passar por formulário externo nem
// pela etapa manual de abertura de vaga (ver lib/sales/deal-handoff.ts).
export type SalesDealProfile = {
  course?: string | null
  semester_min?: number | null
  semester_max?: number | null
  city?: string | null
  modality?: string | null
  positions_needed?: number | null
  urgency?: 'low' | 'normal' | 'high' | null
}

const DEAL_REQUIRED_FIELDS = ['course', 'city', 'modality', 'positions_needed'] as const satisfies readonly (keyof SalesDealProfile)[]

const DEAL_FIELD_LABELS: Record<(typeof DEAL_REQUIRED_FIELDS)[number], string> = {
  course: 'curso desejado',
  city: 'cidade',
  modality: 'modalidade (presencial, híbrido ou remoto)',
  positions_needed: 'quantidade de vagas',
}

function isDealProfileComplete(profile: SalesDealProfile): boolean {
  return DEAL_REQUIRED_FIELDS.every((key) => {
    const value = profile[key]
    return value !== null && value !== undefined && value !== ('' as unknown)
  })
}

function missingDealFields(profile: SalesDealProfile): string[] {
  return DEAL_REQUIRED_FIELDS.filter((key) => {
    const value = profile[key]
    return value === null || value === undefined || value === ('' as unknown)
  }).map((key) => DEAL_FIELD_LABELS[key])
}

function mergeDealProfile(current: SalesDealProfile, updates: SalesDealProfile | undefined): SalesDealProfile {
  const merged: SalesDealProfile = { ...current }
  for (const [key, value] of Object.entries(updates ?? {})) {
    if (value === null || value === undefined || value === '') continue
    ;(merged as Record<string, unknown>)[key] = value
  }
  return merged
}

type DealExtractionOutput = {
  deal_confirmed?: boolean
  deal_profile_updates?: SalesDealProfile
}

function buildDealExtractorPrompt(businessProfile: Record<string, unknown>, currentDeal: SalesDealProfile): string {
  const documentoFechamento =
    typeof businessProfile.documento_fechamento === 'string' && businessProfile.documento_fechamento.trim()
      ? businessProfile.documento_fechamento
      : null

  return [
    'Você está analisando a ÚLTIMA mensagem de um cliente numa conversa de vendas pelo WhatsApp para decidir se ele acabou de confirmar o FECHAMENTO de um negócio de verdade (quer contratar/comprar/seguir em frente agora — intenção vaga como "vou pensar" ou "depois eu vejo" NÃO conta como fechamento) e, se sim, extrair os dados que o setor responsável precisa para dar sequência.',
    `Dados já coletados sobre este fechamento até agora: ${JSON.stringify(currentDeal)}.`,
    'Extraia SOMENTE o que a última mensagem do cliente trouxe de novo (não repita o que já estava coletado): curso desejado (course, texto), semestre mínimo (semester_min, número) e máximo (semester_max, número) se mencionados, cidade (city, texto), modalidade de trabalho — presencial, hibrido ou remoto (modality, texto), quantidade de vagas/pessoas que o cliente precisa (positions_needed, número), e a urgência (urgency: "low", "normal" ou "high").',
    documentoFechamento
      ? `A empresa pediu para você registrar isto no momento do fechamento: "${documentoFechamento}" — leve isso em conta, mas não invente que foi tratado se não foi.`
      : '',
    'Responda SOMENTE um JSON válido: {"deal_confirmed": boolean, "deal_profile_updates": {"course": string|null, "semester_min": number|null, "semester_max": number|null, "city": string|null, "modality": string|null, "positions_needed": number|null, "urgency": string|null}}.',
    'Não invente valores: use null para o que não foi dito nesta mensagem.',
  ]
    .filter(Boolean)
    .join(' ')
}

// Fechamento genérico (item 2 — negócio que não é recrutamento/estágio):
// aqui não existe "vaga" nenhuma para levantar, então a extração só
// precisa decidir se o cliente acabou de confirmar o fechamento — sem
// pedir dados no formato de vaga (curso/cidade/modalidade), que não
// fazem sentido fora do vertical de recrutamento.
type GenericDealExtractionOutput = { deal_confirmed?: boolean }

function buildGenericDealConfirmationPrompt(businessProfile: Record<string, unknown>): string {
  const documentoFechamento =
    typeof businessProfile.documento_fechamento === 'string' && businessProfile.documento_fechamento.trim()
      ? businessProfile.documento_fechamento
      : null

  return [
    'Você está analisando a ÚLTIMA mensagem de um cliente numa conversa de vendas pelo WhatsApp para decidir se ele acabou de confirmar o FECHAMENTO de um negócio de verdade (quer comprar/contratar/seguir em frente agora — intenção vaga como "vou pensar" ou "depois eu vejo" NÃO conta como fechamento).',
    documentoFechamento
      ? `A empresa pediu para você registrar isto no momento do fechamento: "${documentoFechamento}" — leve isso em conta, mas não invente que foi tratado se não foi.`
      : '',
    'Responda SOMENTE um JSON válido: {"deal_confirmed": boolean}.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Natureza do fechamento aprendida na entrevista (campo
 * `fechamento_natureza`, novo — ver lib/interview/engine.ts). Sem esse
 * campo (perfis de empresa entrevistados antes dele existir), mantém o
 * comportamento histórico deste produto (recrutamento/estágios), que é
 * o único vertical que já rodou em produção até aqui.
 */
export function isRecruitmentDeal(businessProfile: Record<string, unknown>): boolean {
  return businessProfile.fechamento_natureza !== 'venda_ou_servico'
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
  'Se o cliente pedir uma apresentação, catálogo, portfólio ou material sobre o negócio: você NÃO tem como enviar arquivos, então nunca prometa mandar um documento. Em vez disso, resuma ali mesmo na conversa, em poucas frases: a dor/problema do cliente, o que o produto/serviço resolve, e a vantagem concreta de fechar agora — sempre usando o que você aprendeu sobre a empresa.',
].join(' ')

export function buildSystemPrompt(agentConfig: AgentConfig, unit: Unit, dealProfile?: SalesDealProfile): string {
  const businessContext = buildBusinessContext(agentConfig.business_profile)
  const profile = (agentConfig.business_profile ?? {}) as Record<string, unknown>
  const closesAlone = profile.fechamento === 'fecha_sozinho'
  const recruitmentDeal = isRecruitmentDeal(profile)
  const documentoFechamento =
    typeof profile.documento_fechamento === 'string' && profile.documento_fechamento.trim()
      ? profile.documento_fechamento
      : null

  const dealSection = closesAlone
    ? recruitmentDeal
      ? [
          'FECHAMENTO DE NEGÓCIO: quando o cliente confirmar que quer fechar de verdade (contratar/comprar/seguir agora, não apenas demonstrar interesse), você mesmo levanta os dados que o setor responsável precisa para dar sequência — direto na conversa, sem pedir para preencher nenhum formulário externo. No máximo 2 perguntas por mensagem: curso desejado, semestre, cidade e modalidade de trabalho (presencial, híbrido ou remoto), quantidade de vagas, e a urgência.',
          dealProfile && Object.keys(dealProfile).length > 0
            ? `Dados já coletados sobre este fechamento: ${JSON.stringify(dealProfile)}. Pergunte só o que ainda falta: ${missingDealFields(dealProfile).join(', ') || 'nada, já está completo'}.`
            : '',
          documentoFechamento
            ? `A empresa também pediu, no momento do fechamento, que você confirme/registre: "${documentoFechamento}".`
            : '',
          'Assim que tiver os dados, avise o cliente que vai passar a finalização para o setor responsável (o que fizer mais sentido pro negócio: RH, comercial, contratos) e que alguém dará continuidade — não prometa prazos exatos nem detalhes que você não sabe.',
        ]
          .filter(Boolean)
          .join(' ')
      : [
          'FECHAMENTO DE NEGÓCIO: quando o cliente confirmar que quer fechar de verdade (comprar/contratar/seguir agora, não apenas demonstrar interesse), confirme o fechamento com entusiasmo e reforce o valor da decisão.',
          documentoFechamento
            ? `A empresa também pediu, no momento do fechamento, que você confirme/registre: "${documentoFechamento}".`
            : '',
          'Avise o cliente que vai passar a finalização para o setor responsável e que alguém dará continuidade — não prometa prazos exatos nem detalhes que você não sabe.',
        ]
          .filter(Boolean)
          .join(' ')
    : ''

  return [
    `Você é ${agentConfig.persona_name}, um AI Sales Representative (pré-vendas) que atende pelo WhatsApp em nome da unidade ${unit.name}${unit.region_city ? ` (${unit.region_city})` : ''}.`,
    `Seu tom de comunicação deve ser ${TONE_LABEL[agentConfig.persona_tone]}.`,
    closesAlone
      ? 'Seu objetivo é qualificar o lead e conduzir a venda até o fechamento, conforme combinado com a empresa.'
      : 'Seu objetivo é qualificar o lead e conseguir agendar uma conversa com um vendedor humano.',
    'Responda sempre em português do Brasil, de forma breve (no máximo 3 frases curtas), sem usar markdown ou listas.',
    IDENTITY_AND_HANDOFF_RULES,
    SALES_EXPERTISE_RULES,
    ...(businessContext
      ? [
          businessContext,
          'Responda dúvidas sobre produtos, preços e condições usando somente a ficha acima. Nunca ofereça desconto além da política de desconto registrada, e respeite o combinado sobre até onde você conduz a venda.',
        ]
      : []),
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
}): Promise<ProcessInboundResult> {
  const { supabase, unit, lead, incomingText } = params
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
    return noHandoff
  }

  // Fechamento de negócio (item 2): só faz sentido levantar o perfil da
  // vaga quando o próprio agente conduz a venda até o fim (fecha_sozinho)
  // e o lead ainda não fechou — se ele só qualifica e passa para um
  // humano, o fechamento real acontece fora da conversa e este agente
  // não tem como observá-lo.
  const businessProfile = (config.business_profile ?? {}) as Record<string, unknown>
  const closesAlone = businessProfile.fechamento === 'fecha_sozinho'
  // Recrutamento/estágio (o vertical original) levanta um perfil de vaga
  // estruturado; qualquer outro negócio (venda de produto/serviço etc.)
  // só precisa detectar a confirmação — perguntar "curso" ou "modalidade"
  // não faz sentido fora de recrutamento (ver isRecruitmentDeal).
  const recruitmentDeal = isRecruitmentDeal(businessProfile)
  let dealProfile = (lead.deal_profile ?? {}) as SalesDealProfile
  let dealConfirmedThisTurn = false

  if (closesAlone && !lead.deal_closed_at) {
    try {
      if (recruitmentDeal) {
        const extraction = await generateStructuredReply<DealExtractionOutput>({
          apiKey,
          systemPrompt: buildDealExtractorPrompt(businessProfile, dealProfile),
          history: [{ role: 'user', content: incomingText }],
          maxTokens: 500,
        })
        dealProfile = mergeDealProfile(dealProfile, extraction.deal_profile_updates)
        dealConfirmedThisTurn = extraction.deal_confirmed === true
      } else {
        const extraction = await generateStructuredReply<GenericDealExtractionOutput>({
          apiKey,
          systemPrompt: buildGenericDealConfirmationPrompt(businessProfile),
          history: [{ role: 'user', content: incomingText }],
          maxTokens: 200,
        })
        dealConfirmedThisTurn = extraction.deal_confirmed === true
      }
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

  let reply: string
  try {
    reply = await generateChatReply({
      apiKey,
      systemPrompt: buildSystemPrompt(config, unit, dealProfile),
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
    return noHandoff
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

  // Recrutamento exige o perfil de vaga completo antes de fechar; negócio
  // genérico (sem vaga nenhuma envolvida) fecha assim que confirmado.
  const readyToClose =
    closesAlone &&
    !lead.deal_closed_at &&
    dealConfirmedThisTurn &&
    (recruitmentDeal ? isDealProfileComplete(dealProfile) : true)

  const leadUpdate: Record<string, unknown> = { last_contacted_at: sentAt }
  if (closesAlone && !lead.deal_closed_at) {
    if (recruitmentDeal) leadUpdate.deal_profile = dealProfile
    if (readyToClose) {
      leadUpdate.status = 'won'
      leadUpdate.deal_closed_at = sentAt
    }
  }
  await supabase.from('leads').update(leadUpdate).eq('id', lead.id)

  return { dealHandoffReady: readyToClose }
}
