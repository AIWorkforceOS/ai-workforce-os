import type { SupabaseClient } from '@supabase/supabase-js'
import { generateChatReply, generateStructuredReply, getOpenAIApiKey, type ChatMessage } from '@/lib/openai'
import {
  getMessagingChannel,
  getEmailChannel,
  channelLabel,
  type AttachmentToSend,
  type ChannelType,
} from '@/lib/channels/messaging-channel'
import { sendTechnicalAlertEmail } from '@/lib/email'
import { logSystemEvent, shouldNotifyForEvent, type SystemEventSource } from '@/lib/system-events'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { fetchActiveAttachments, buildAttachmentsContext } from '@/lib/attachments'
import { fmtMoment } from '@/lib/scheduling/appointment-notifications'
import { localDateString } from '@/lib/slot-engine'
import { unitDefaultLocale } from '@/lib/i18n/config'
import type { Locale } from '@/lib/i18n/config'
import { buildReceptionistSystemPrompt } from './prompt'
import { notifyReceptionistHandoff, type HandoffTarget } from './handoff'
import {
  loadUpcomingAppointments,
  loadActiveServices,
  resolveServiceByName,
  computeSlotsForService,
  findSlotAtTime,
  listSlotsText,
  executeCancelAppointment,
  executeReschedule,
  executeBooking,
} from './scheduling'
import type { AgentConfig, Customer, EmployeeAttachment, Service, Unit } from '@/lib/types'
import type { CustomerMessage, UpcomingAppointment } from './types'

// Motor de conversa do AI Receptionist (Fase 2 do funcionário — a Fase
// 1, lib/receptionist/prompt.ts, só fixava a persona; aqui ela ganha
// canal de verdade). Espelha a forma de lib/conversation-engine.ts
// (processInboundMessage) e lib/recruiter/screening-engine.ts
// (handleCandidateInbound), adaptado pro objeto "cliente" (não lead
// nem candidato) e com duas responsabilidades novas que nenhum dos
// outros dois tem: agenda conversacional (reagendar/marcar/cancelar
// direto na conversa) e handoff simples pra outro time.
//
// Decisão deliberada (item do pedido: "sempre pronta"): diferente do
// SDR/Recruiter, este motor NÃO aplica active_hours nem daily_limit —
// esses dois campos existem em agent_configs pra conter ENVIO
// PROATIVO em massa (outreach, follow-up automático); a Recepcionista
// só responde a quem já escreveu pra ela, então throttle de spam não
// se aplica e contraria o pedido explícito de disponibilidade full-time.

export type ReceptionistIntentExtraction = {
  handoff?: 'none' | 'sales' | 'recruiting' | 'human'
  handoff_reason?: string | null
  appointment_action?: 'none' | 'info' | 'reschedule' | 'book' | 'cancel'
  appointment_id?: string | null
  service_name?: string | null
  /** YYYY-MM-DD, resolvido pelo modelo a partir de linguagem natural ("amanhã", "sexta que vem") — ver "hoje é..." no prompt do extrator. */
  desired_date?: string | null
  /** HH:MM (24h) */
  desired_time?: string | null
}

function buildIntentExtractorPrompt(params: {
  unit: Unit
  upcoming: UpcomingAppointment[]
  services: Service[]
  locale: Locale
}): string {
  const { unit, upcoming, services, locale } = params
  const now = new Date()
  const today = localDateString(now, unit.timezone)
  const weekday = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'pt-BR', {
    weekday: 'long',
    timeZone: unit.timezone,
  }).format(now)

  const upcomingList =
    upcoming.length > 0
      ? upcoming.map((a) => `id "${a.id}": ${a.service_name ?? 'serviço'} em ${fmtMoment(a.starts_at, unit.timezone, locale)}`).join('; ')
      : 'nenhum'
  const servicesList = services.length > 0 ? services.map((s) => s.name).join(', ') : 'nenhum serviço cadastrado'

  return [
    'Você está analisando a ÚLTIMA mensagem de um cliente numa conversa com a recepcionista digital de uma empresa, pra decidir se ela precisa executar alguma ação de agenda ou encaminhar a conversa pra outra pessoa/setor. Não escreva a resposta ao cliente aqui — só extraia a decisão.',
    `Hoje é ${today} (${weekday}), fuso horário ${unit.timezone}. Resolva datas relativas ("amanhã", "sexta que vem", "dia 5") pro formato YYYY-MM-DD com base nisso.`,
    `Agendamentos futuros deste cliente: ${upcomingList}.`,
    `Serviços que a unidade oferece: ${servicesList}.`,
    'Responda SOMENTE um JSON válido: {"handoff": "none"|"sales"|"recruiting"|"human", "handoff_reason": string|null, "appointment_action": "none"|"info"|"reschedule"|"book"|"cancel", "appointment_id": string|null, "service_name": string|null, "desired_date": string|null, "desired_time": string|null}.',
    '"handoff" = "sales" quando o cliente quer negociar/comprar algo novo fora do que já está combinado; "recruiting" quando pergunta sobre vaga de emprego/trabalhar na empresa; "human" quando é reclamação séria, pedido de cancelamento de contrato, ou qualquer coisa fora do alcance de uma recepcionista; "none" no resto (dúvida geral, agenda, pós-venda simples que você mesma resolve).',
    '"appointment_action" = "info" quando o cliente só quer confirmar/saber sobre um agendamento existente sem mudar nada; "reschedule" quando quer mudar o horário de um agendamento existente (use "appointment_id" com o id EXATO da lista acima — se só existe um agendamento futuro, use esse mesmo sem perguntar o id); "book" quando quer marcar um atendimento novo (use "service_name" com o nome mais parecido da lista de serviços); "cancel" quando quer cancelar um agendamento existente; "none" quando não é sobre agenda.',
    '"desired_date" e "desired_time" só quando o cliente deu ou confirmou um dia/horário NESTA mensagem — deixe null se ele ainda não disse ou se a ação não precisa disso.',
    'Nunca invente um appointment_id ou service_name fora das listas acima.',
  ].join(' ')
}

async function fetchCustomerHistory(supabase: SupabaseClient, customerId: string, limit = 20): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('customer_messages')
    .select('*')
    .eq('customer_id', customerId)
    .order('sent_at', { ascending: true })
    .limit(limit)

  return ((data as CustomerMessage[] | null) ?? []).map((row) => ({
    role: row.direction === 'inbound' ? 'user' : 'assistant',
    content: row.content,
  }))
}

async function reportAgentFailure(params: {
  supabase: SupabaseClient
  unit: Unit
  customer: Customer
  source: SystemEventSource
  eventType: string
  message: string
}): Promise<void> {
  const { supabase, unit, customer, source, eventType, message } = params

  await logSystemEvent(supabase, {
    level: 'error',
    source,
    eventType,
    message,
    orgId: unit.org_id,
    unitId: unit.id,
    metadata: { customer_id: customer.id },
  })

  const notify = await shouldNotifyForEvent(supabase, { eventType, unitId: unit.id })
  if (!notify || !unit.org_id) return

  const { data: org } = await supabase.from('organizations').select('owner_email').eq('id', unit.org_id).maybeSingle()
  const ownerEmail = (org as { owner_email: string | null } | null)?.owner_email
  if (!ownerEmail) return

  await sendTechnicalAlertEmail({
    to: ownerEmail,
    unitName: unit.name,
    problem: message,
    impact: `O cliente "${customer.name}" mandou mensagem para a recepcionista e não recebeu resposta automática.`,
  })
}

/** Resolve a ação de agenda pedida nesta mensagem (Fase B, determinística) e devolve o texto de contexto que ancora a resposta gerada na Fase C — nunca deixa o modelo "confirmar" algo que não foi de fato verificado/gravado no banco. */
async function resolveAppointmentAction(params: {
  supabase: SupabaseClient
  unit: Unit
  customer: Customer
  extraction: ReceptionistIntentExtraction
  upcoming: UpcomingAppointment[]
  services: Service[]
  locale: Locale
}): Promise<string | null> {
  const { supabase, unit, customer, extraction, upcoming, services, locale } = params
  const action = extraction.appointment_action ?? 'none'
  if (action === 'none') return null

  if (action === 'info') {
    if (upcoming.length === 0) return 'Este cliente não tem nenhum agendamento futuro.'
    return `Agendamentos futuros do cliente: ${upcoming.map((a) => `${a.service_name ?? 'serviço'} em ${fmtMoment(a.starts_at, unit.timezone, locale)}`).join('; ')}.`
  }

  if (action === 'cancel' || action === 'reschedule') {
    const target = extraction.appointment_id
      ? upcoming.find((a) => a.id === extraction.appointment_id)
      : upcoming.length === 1
        ? upcoming[0]!
        : null

    if (!target) {
      return upcoming.length > 1
        ? 'O cliente tem mais de um agendamento futuro e não ficou claro qual — pergunte qual deles.'
        : 'Não encontrei nenhum agendamento futuro deste cliente para essa ação — avise com gentileza que não achou nada agendado.'
    }

    if (action === 'cancel') {
      const outcome = await executeCancelAppointment(supabase, unit, target, locale)
      return outcome.context
    }

    // reschedule
    if (!extraction.desired_date) {
      return `Cliente quer remarcar o agendamento de ${target.service_name ?? 'serviço'} (atualmente em ${fmtMoment(target.starts_at, unit.timezone, locale)}) mas não disse pra qual dia — pergunte.`
    }

    const service = target.service_id ? services.find((s) => s.id === target.service_id) : null
    if (!service) return 'Não encontrei o serviço deste agendamento no catálogo — avise que vai verificar com o time.'

    const slots = await computeSlotsForService(supabase, unit, service, extraction.desired_date, target.id)
    if (extraction.desired_time) {
      const slot = findSlotAtTime(slots, unit, extraction.desired_time)
      if (slot) {
        const outcome = await executeReschedule(supabase, unit, target, slot, locale)
        return outcome.context
      }
      return `Horário pedido (${extraction.desired_time}) não está livre em ${extraction.desired_date}. Horários livres nesse dia: ${listSlotsText(slots, unit, locale)}.`
    }
    return `Horários livres em ${extraction.desired_date} para ${service.name}: ${listSlotsText(slots, unit, locale)}. Pergunte qual horário o cliente prefere.`
  }

  // action === 'book'
  const service = resolveServiceByName(services, extraction.service_name)
  if (!service) {
    return services.length === 0
      ? 'A unidade ainda não tem nenhum serviço cadastrado pra agendar — avise que vai verificar com o time.'
      : 'Não ficou claro qual serviço o cliente quer agendar — pergunte qual serviço, entre os oferecidos.'
  }
  if (!extraction.desired_date) {
    return `Cliente quer marcar ${service.name} mas não disse o dia — pergunte qual dia prefere.`
  }

  const slots = await computeSlotsForService(supabase, unit, service, extraction.desired_date)
  if (extraction.desired_time) {
    const slot = findSlotAtTime(slots, unit, extraction.desired_time)
    if (slot) {
      const outcome = await executeBooking(supabase, unit, customer.id, service, slot, locale)
      return outcome.context
    }
    return `Horário pedido (${extraction.desired_time}) não está livre em ${extraction.desired_date}. Horários livres nesse dia: ${listSlotsText(slots, unit, locale)}.`
  }
  return `Horários livres em ${extraction.desired_date} para ${service.name}: ${listSlotsText(slots, unit, locale)}. Pergunte qual horário o cliente prefere.`
}

export type ProcessReceptionistResult = { handled: boolean }

export async function processReceptionistInbound(params: {
  supabase: SupabaseClient
  unit: Unit
  customer: Customer
  incomingText: string
  /** Canal por onde a mensagem chegou — a resposta sai pelo mesmo canal (sem fan-out pros outros, diferente do primeiro-contato do SDR). */
  channel: ChannelType
  /** Telefone ou e-mail exato de onde a mensagem veio, usado como destinatário da resposta. */
  recipient: string
  wasAudioMessage?: boolean
}): Promise<ProcessReceptionistResult> {
  const { supabase, unit, customer, incomingText, channel, recipient, wasAudioMessage } = params
  const failed: ProcessReceptionistResult = { handled: false }

  const { data: agentConfigRow } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('agent_type', 'receptionist')
    .maybeSingle()
  const config = agentConfigRow as AgentConfig | null

  if (!config || !config.is_active) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'receptionist',
      eventType: 'agent_not_configured',
      message: `Cliente "${customer.name}" mandou mensagem na unidade "${unit.name}" mas a Recepcionista está ${config ? 'inativa' : 'sem configuração'} — nenhuma resposta enviada.`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
    return failed
  }

  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    await reportAgentFailure({
      supabase,
      unit,
      customer,
      source: 'openai',
      eventType: 'missing_env_openai',
      message: 'OPENAI_API_KEY não está configurada — a Recepcionista não consegue gerar respostas.',
    })
    return failed
  }

  const channelImpl = channel === 'email' ? getEmailChannel(unit) : getMessagingChannel(unit, supabase)
  if (!channelImpl) {
    await reportAgentFailure({
      supabase,
      unit,
      customer,
      source: channel === 'email' ? 'resend' : channel === 'sms' ? 'twilio' : 'evolution',
      eventType: channel === 'email' ? 'missing_env_resend' : channel === 'sms' ? 'missing_env_twilio' : 'missing_env_evolution',
      message: `Canal ${channelLabel(channel)} não configurado para a unidade "${unit.name}" — a Recepcionista não consegue responder.`,
    })
    return failed
  }

  const locale = unitDefaultLocale(unit)

  const [history, upcoming, services, organizationProfile] = await Promise.all([
    fetchCustomerHistory(supabase, customer.id),
    loadUpcomingAppointments(supabase, unit, customer.id),
    loadActiveServices(supabase, unit),
    fetchOrganizationBusinessProfile(supabase, unit.org_id),
  ])

  // Fase A: extração de intenção (agenda + handoff), sem gerar texto ainda.
  const extraction = await generateStructuredReply<ReceptionistIntentExtraction>({
    apiKey,
    systemPrompt: buildIntentExtractorPrompt({ unit, upcoming, services, locale }),
    history,
    maxTokens: 400,
  }).catch((error) => {
    console.error(`[receptionist_engine] extração de intenção falhou: ${error instanceof Error ? error.message : String(error)}`)
    return {} as ReceptionistIntentExtraction
  })

  // Fase B: executa a ação (agenda/handoff) e monta o contexto factual que ancora a resposta.
  let handoffTarget: HandoffTarget | null = null
  if (extraction.handoff && extraction.handoff !== 'none') {
    handoffTarget = extraction.handoff
    await notifyReceptionistHandoff(supabase, {
      unit,
      customer,
      target: handoffTarget,
      reason: extraction.handoff_reason?.trim() || 'assunto fora do escopo da recepcionista',
      lastMessage: incomingText,
    })
  }

  const appointmentContext = await resolveAppointmentAction({ supabase, unit, customer, extraction, upcoming, services, locale })

  const extraContext = [
    appointmentContext
      ? `CONTEXTO DESTA RESPOSTA (ação de agenda já verificada/executada — baseie-se estritamente nisso, nunca contradiga nem invente outro resultado): ${appointmentContext}`
      : '',
    handoffTarget
      ? 'Você já registrou o encaminhamento deste assunto para o time responsável — diga ao cliente, com naturalidade, que vai passar a conversa para a pessoa certa continuar.'
      : '',
  ]
    .filter(Boolean)
    .join(' ')

  // Fase C: geração da resposta (com decisão de anexo, quando há biblioteca configurada).
  const attachments = await fetchActiveAttachments(supabase, unit.id, 'receptionist')
  const attachmentsContext = buildAttachmentsContext(attachments)
  const basePrompt = buildReceptionistSystemPrompt(config, unit, organizationProfile)

  let reply: string
  let chosenAttachment: EmployeeAttachment | null = null
  try {
    if (attachments.length > 0) {
      const structured = await generateStructuredReply<{ reply?: string; attachment_id?: string | null }>({
        apiKey,
        systemPrompt: [
          basePrompt,
          extraContext,
          attachmentsContext,
          'Responda SOMENTE um JSON válido: {"reply": string, "attachment_id": string|null}. O campo "reply" é a mensagem normal que você mandaria ao cliente, seguindo à risca as regras de tom, tamanho e idioma já combinadas acima. O campo "attachment_id" é o id do material a enviar agora (ver MATERIAIS DISPONÍVEIS PARA ENVIAR acima), ou null se nenhum se aplica a esta mensagem.',
        ]
          .filter(Boolean)
          .join(' '),
        history,
        temperature: 0.7,
      })
      reply = (structured.reply ?? '').trim()
      const attachmentId = structured.attachment_id ?? null
      chosenAttachment = attachmentId ? attachments.find((a) => a.id === attachmentId) ?? null : null
    } else {
      reply = await generateChatReply({
        apiKey,
        systemPrompt: [basePrompt, extraContext].filter(Boolean).join(' '),
        history,
      })
    }
  } catch (error) {
    await reportAgentFailure({
      supabase,
      unit,
      customer,
      source: 'openai',
      eventType: 'openai_api_error',
      message: `Falha na OpenAI ao gerar resposta da Recepcionista: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
    })
    return failed
  }

  if (!reply) return failed

  // Link (e PDF no SMS, que não segura arquivo real) sempre embutido no
  // texto; PDF em WhatsApp/e-mail vira anexo de verdade — mesma regra do
  // SDR/Recruiter (ver lib/conversation-engine.ts).
  let outgoingText = reply
  let attachmentPayload: AttachmentToSend | undefined
  if (chosenAttachment) {
    if (chosenAttachment.kind === 'link' || channel === 'sms') {
      outgoingText = `${reply}\n\n${chosenAttachment.title}: ${chosenAttachment.file_url}`
    } else {
      attachmentPayload = { title: chosenAttachment.title, url: chosenAttachment.file_url, fileName: chosenAttachment.file_name }
    }
  }

  try {
    await channelImpl.sendMessage(recipient, outgoingText, {
      voiceReply: wasAudioMessage,
      attachment: attachmentPayload,
      personaName: config.persona_name,
      subject: config.persona_name,
    })
  } catch (error) {
    await supabase.from('customer_messages').insert({
      customer_id: customer.id,
      unit_id: unit.id,
      channel,
      direction: 'outbound',
      content: outgoingText,
      status: 'failed',
      sent_at: new Date().toISOString(),
    })
    await reportAgentFailure({
      supabase,
      unit,
      customer,
      source: channel === 'email' ? 'resend' : channel === 'sms' ? 'twilio' : 'evolution',
      eventType: channel === 'email' ? 'resend_send_failed' : channel === 'sms' ? 'twilio_send_failed' : 'evolution_send_failed',
      message: `Falha ao enviar resposta via ${channelLabel(channel)}: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
    })
    return failed
  }

  await supabase.from('customer_messages').insert({
    customer_id: customer.id,
    unit_id: unit.id,
    channel,
    direction: 'outbound',
    content: outgoingText,
    status: 'sent',
    sent_at: new Date().toISOString(),
  })

  return { handled: true }
}
