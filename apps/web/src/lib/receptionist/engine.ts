import type { SupabaseClient } from '@supabase/supabase-js'
import { generateChatReply, generateStructuredReply, getOpenAIApiKey, type ChatMessage } from '@/lib/openai'
import {
  getMessagingChannel,
  getEmailChannel,
  channelLabel,
  type AttachmentToSend,
  type ChannelType,
} from '@/lib/channels/messaging-channel'
import { resolveWhatsappChannel } from '@/lib/evolution'
import { sendTechnicalAlertEmail } from '@/lib/email'
import { logSystemEvent, shouldNotifyForEvent, hasRecentEventForContact, type SystemEventSource } from '@/lib/system-events'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { fetchActiveAttachments, buildAttachmentsContext } from '@/lib/attachments'
import { fmtMoment } from '@/lib/scheduling/appointment-notifications'
import { localDateString } from '@/lib/slot-engine'
import { unitDefaultLocale } from '@/lib/i18n/config'
import type { Locale } from '@/lib/i18n/config'
import { buildReceptionistSystemPrompt } from './prompt'
import { notifyReceptionistHandoff, handoffToSales, type HandoffTarget } from './handoff'
import { provisionCustomerFromLead } from './customers'
import { answerTechSupportQuestion } from '@/lib/ti/engine'
import { jobApplicationUrl } from '@/lib/recruiter/reporting'
import { CLOSED_FOR_APPLICATION_STATUSES } from '@/lib/recruiter/candidate-intake'
import type { JobOpening } from '@/lib/recruiter/types'
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
import type { AgentConfig, Customer, EmployeeAttachment, Lead, Service, Unit } from '@/lib/types'
import type { CustomerMessage, UpcomingAppointment } from './types'

/**
 * Janela de cooldown de reescalação de handoff: dentro dela, um novo
 * handoff pro MESMO alvo pro MESMO contato não dispara um novo alerta pro
 * time nem um novo acionamento do Sales (notifyReceptionistHandoff/
 * handoffToSales) — só o guard de prompt (buildIntentExtractorPrompt) não
 * bastava sob uso real (9 alertas em 22min pro mesmo contato, confirmado em
 * produção). 120min é uma escolha de produto sem pedido explícito de
 * duração: alto o bastante pra cobrir uma sequência de "ok"/"obrigado" numa
 * mesma conversa, baixo o bastante pra não engolir um handoff genuinamente
 * novo se o mesmo assunto reaparecer horas depois.
 */
const HANDOFF_COOLDOWN_MINUTES = 120

/**
 * Resolve o canal de mensagens da Recepcionista para esta unidade —
 * WhatsApp usa a instância dedicada dela (agent_type='receptionist')
 * quando existir (migration 051), senão cai no número compartilhado
 * histórico; SMS/e-mail não têm conceito de instância múltipla, então
 * seguem exatamente como antes.
 */
async function resolveReceptionistMessagingChannel(supabase: SupabaseClient, unit: Unit, channel: ChannelType) {
  if (channel === 'email') return getEmailChannel(unit)
  if (channel === 'sms') return getMessagingChannel(unit, supabase)

  const resolved = await resolveWhatsappChannel(supabase, unit, 'receptionist')
  return getMessagingChannel(unit, supabase, resolved?.config ?? null)
}

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
  handoff?: 'none' | 'sales' | 'recruiting' | 'human' | 'ti'
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
    'Responda SOMENTE um JSON válido: {"handoff": "none"|"sales"|"recruiting"|"human"|"ti", "handoff_reason": string|null, "appointment_action": "none"|"info"|"reschedule"|"book"|"cancel", "appointment_id": string|null, "service_name": string|null, "desired_date": string|null, "desired_time": string|null}.',
    '"handoff" = "sales" quando o cliente quer negociar/comprar algo novo fora do que já está combinado; "recruiting" quando pergunta sobre vaga de emprego/trabalhar na empresa; "human" quando é reclamação séria, pedido de cancelamento de contrato, ou qualquer coisa fora do alcance de uma recepcionista; "ti" quando o cliente tem dúvida sobre como usar ou achar alguma funcionalidade da própria PLATAFORMA ALIZO (o sistema, não o negócio dele), ou relatou um erro/bug/comportamento estranho do SISTEMA; "none" no resto (dúvida geral, agenda, pós-venda simples que você mesma resolve).',
    'IMPORTANTE: olhe o HISTÓRICO da conversa antes de decidir. Se você (o assistente) já escalou esse MESMO assunto para humano/vendas/recrutamento em uma mensagem anterior recente e o cliente não trouxe nenhuma informação nova sobre ele (só confirmou, agradeceu, disse "ok", "obrigado", "deu certo" ou repetiu o que já tinha dito), classifique "handoff" como "none" — não escale de novo o que já está escalado.',
    '"appointment_action" = "info" quando o cliente só quer confirmar/saber sobre um agendamento existente sem mudar nada; "reschedule" quando quer mudar o horário de um agendamento existente (use "appointment_id" com o id EXATO da lista acima — se só existe um agendamento futuro, use esse mesmo sem perguntar o id); "book" quando quer marcar um atendimento novo (use "service_name" com o nome mais parecido da lista de serviços); "cancel" quando quer cancelar um agendamento existente; "none" quando não é sobre agenda.',
    '"desired_date" e "desired_time" só quando o cliente deu ou confirmou um dia/horário NESTA mensagem — deixe null se ele ainda não disse ou se a ação não precisa disso.',
    'Nunca invente um appointment_id ou service_name fora das listas acima.',
  ].join(' ')
}

/**
 * Busca as ÚLTIMAS `limit` mensagens (não as primeiras): ordena por
 * mais recente e reverte pra ordem cronológica depois. Bug real
 * corrigido aqui (confirmado em produção, unidade Smarter Matriz,
 * 2026-08-11): a versão anterior ordenava ascending e aplicava limit
 * direto, o que devolve as `limit` mensagens MAIS ANTIGAS da conversa,
 * não as mais recentes — numa conversa com mais de `limit` mensagens
 * no total, a pergunta atual do cliente ficava de fora da janela
 * inteira, e o modelo respondia com base em um assunto antigo porque
 * era só isso que ele conseguia ver.
 */
async function fetchCustomerHistory(supabase: SupabaseClient, customerId: string, limit = 20): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('customer_messages')
    .select('*')
    .eq('customer_id', customerId)
    .order('sent_at', { ascending: false })
    .limit(limit)

  const rows = ((data as CustomerMessage[] | null) ?? []).reverse()
  return rows.map((row) => ({
    role: row.direction === 'inbound' ? 'user' : 'assistant',
    content: row.content,
  }))
}

/** `contact` genérico (id/nome) — serve tanto um Customer cadastrado quanto um Lead/prospecto (ver processReceptionistProspectInbound). */
async function reportAgentFailure(params: {
  supabase: SupabaseClient
  unit: Unit
  contact: { id: string; name: string }
  source: SystemEventSource
  eventType: string
  message: string
}): Promise<void> {
  const { supabase, unit, contact, source, eventType, message } = params

  await logSystemEvent(supabase, {
    level: 'error',
    source,
    eventType,
    message,
    orgId: unit.org_id,
    unitId: unit.id,
    metadata: { contact_id: contact.id },
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
    impact: `O contato "${contact.name}" mandou mensagem para a recepcionista e não recebeu resposta automática.`,
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

/**
 * True quando já existe uma mensagem inbound mais recente que a que está
 * sendo processada agora, para o mesmo contato — sinal de que 2 mensagens
 * chegaram quase juntas e 2 pipelines rodaram em paralelo (sem debounce
 * nenhum antes disso: cada inbound sempre disparava extração → geração →
 * envio, independente). Quando true, quem chama deve parar sem responder:
 * a mensagem mais nova vai processar e ver AMBAS no histórico (o insert do
 * inbound acontece antes de chamar o pipeline, ver inbound-router.ts), então
 * a resposta dela cobre as duas — responder aqui também duplicaria a
 * resposta pro cliente (bug confirmado: 2 respostas em 1-5s de diferença).
 */
async function isInboundMessageStale(
  supabase: SupabaseClient,
  table: 'customer_messages' | 'conversations',
  contactColumn: 'customer_id' | 'lead_id',
  contactId: string,
  inboundMessageId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from(table)
    .select('id')
    .eq(contactColumn, contactId)
    .eq('direction', 'inbound')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const latestId = (data as { id: string } | null)?.id
  return Boolean(latestId) && latestId !== inboundMessageId
}

/**
 * Vagas abertas (aceitando candidatura) desta unidade — reaproveita o
 * mesmo link público sem login que o Recruiter já manda pra candidatos
 * (app/vaga/[token], jobApplicationUrl, migration 046). Existe pra
 * corrigir um bug real (candidato perguntou sobre vaga na Recepcionista
 * e ela começou a coletar nome/e-mail/telefone manualmente em vez de
 * mandar o link — confirmado em produção, unidade Smarter Matriz,
 * 2026-08-11): quando já existe uma vaga aberta com candidatura
 * self-service, a Recepcionista deve mandar o link direto, nunca
 * reabrir uma coleta manual que ela não tem como levar adiante sozinha.
 * Genérico — vale pra qualquer organização que use o Recruiter, não é
 * específico de nenhum cliente.
 */
async function fetchOpenJobOpenings(supabase: SupabaseClient, unit: Unit): Promise<Pick<JobOpening, 'id' | 'title' | 'public_application_token'>[]> {
  const { data } = await supabase
    .from('job_openings')
    .select('id, title, public_application_token')
    .eq('unit_id', unit.id)
    .not('status', 'in', `(${CLOSED_FOR_APPLICATION_STATUSES.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(5)

  return (data as Pick<JobOpening, 'id' | 'title' | 'public_application_token'>[] | null) ?? []
}

function buildJobOpeningsContext(jobs: Pick<JobOpening, 'id' | 'title' | 'public_application_token'>[]): string {
  if (jobs.length === 0) return ''

  const list = jobs.map((job) => `"${job.title}": ${jobApplicationUrl(job.public_application_token)}`).join('; ')

  return [
    `VAGAS ABERTAS PARA CANDIDATURA (candidatura é self-service, direto no link — você NUNCA precisa coletar nome, e-mail, telefone ou currículo manualmente pra registrar o interesse de alguém, a própria página faz isso): ${list}.`,
    'Quando alguém perguntar sobre vaga/estágio/oportunidade de trabalho, envie o(s) link(s) acima que fizerem sentido pro perfil dela (com a URL completa na resposta) em vez de começar a fazer perguntas de cadastro. Se nenhuma vaga da lista bater com o que a pessoa procura, diga com clareza que não há vaga aberta nesse perfil agora — nunca prometa "vou buscar e te aviso" ou "vou verificar as vagas disponíveis", porque isso não é algo que você consiga de fato fazer sozinha depois; nesse caso, sinalize para o time de recrutamento (handoff) e diga que alguém do time vai retornar.',
  ].join(' ')
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
  /** Id da linha inbound (customer_messages) que o roteador já inseriu antes de chamar esta função — usado no staleness check (ver isInboundMessageStale) para não responder 2x quando 2 mensagens chegam quase juntas. */
  inboundMessageId?: string
}): Promise<ProcessReceptionistResult> {
  const { supabase, unit, customer, incomingText, channel, recipient, wasAudioMessage, inboundMessageId } = params
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
      contact: { id: customer.id, name: customer.name },
      source: 'openai',
      eventType: 'missing_env_openai',
      message: 'OPENAI_API_KEY não está configurada — a Recepcionista não consegue gerar respostas.',
    })
    return failed
  }

  const channelImpl = await resolveReceptionistMessagingChannel(supabase, unit, channel)
  if (!channelImpl) {
    await reportAgentFailure({
      supabase,
      unit,
      contact: { id: customer.id, name: customer.name },
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

  // Fase B: executa a ação (agenda/handoff/TI) e monta o contexto factual que ancora a resposta.
  const rawHandoff = extraction.handoff ?? 'none'
  let handoffTarget: HandoffTarget | null = null
  let tiAnswerContext = ''

  if (rawHandoff === 'ti') {
    try {
      const tiResult = await answerTechSupportQuestion(supabase, { unit, question: incomingText })
      tiAnswerContext = `CONTEXTO DESTA RESPOSTA (TI interno já verificou e respondeu${tiResult.filedIncident ? '; um chamado técnico já foi registrado para o time' : ''} — baseie sua resposta ao cliente estritamente nisso, com naturalidade, sem inventar nada além disso): ${tiResult.answer}`
    } catch (error) {
      console.error(`[receptionist_engine] TI interno falhou ao responder: ${error instanceof Error ? error.message : String(error)}`)
      handoffTarget = 'human'
    }
  } else if (rawHandoff !== 'none') {
    handoffTarget = rawHandoff
  }

  let pendingSalesHandoff = false
  let sdrPersonaName: string | null = null

  if (handoffTarget) {
    const contact = { name: customer.name, phone: customer.phone, email: customer.email }
    const alreadyEscalated = await hasRecentEventForContact(supabase, {
      eventType: `receptionist_handoff_${handoffTarget}`,
      unitId: unit.id,
      contactId: customer.id,
      windowMinutes: HANDOFF_COOLDOWN_MINUTES,
    })
    const reasonText =
      extraction.handoff_reason?.trim() ||
      (rawHandoff === 'ti' ? 'TI interno falhou ao responder a dúvida sobre a plataforma' : 'assunto fora do escopo da recepcionista')
    if (!alreadyEscalated) {
      await notifyReceptionistHandoff(supabase, {
        unit,
        contact,
        contactId: customer.id,
        target: handoffTarget,
        reason: reasonText,
        lastMessage: incomingText,
      })
      if (handoffTarget === 'sales') {
        await handoffToSales(supabase, { unit, contact, history, reason: reasonText, fromPersonaName: config.persona_name })
      }
    }
    if (handoffTarget === 'sales') pendingSalesHandoff = true
  }

  // Continuidade pós-handoff pro Sales (item 3 do pedido de 2026-08-14):
  // mesmo quando ESTE turno não classificou handoff de novo (ex.: cliente só
  // confirmou/repetiu o mesmo assunto e o extrator corretamente reconheceu
  // que já foi escalado, ver instrução IMPORTANTE no prompt acima), se
  // existe um handoff pra sales recente pro MESMO contato, a Recepcionista
  // não deve tentar resolver/verificar isso sozinha de novo — bug real
  // confirmado em produção: ela repetia "vou verificar com o time" mesmo
  // depois de já ter passado a dúvida pro SDR, porque nada avisava a fase
  // de geração da resposta sobre o handoff de turnos anteriores.
  if (!pendingSalesHandoff) {
    pendingSalesHandoff = await hasRecentEventForContact(supabase, {
      eventType: 'receptionist_handoff_sales',
      unitId: unit.id,
      contactId: customer.id,
      windowMinutes: HANDOFF_COOLDOWN_MINUTES,
    })
  }
  if (pendingSalesHandoff) {
    const { data: sdrConfigRow } = await supabase
      .from('agent_configs')
      .select('persona_name')
      .eq('unit_id', unit.id)
      .eq('agent_type', 'sdr')
      .maybeSingle()
    sdrPersonaName = (sdrConfigRow as { persona_name: string } | null)?.persona_name ?? null
  }

  const appointmentContext = await resolveAppointmentAction({ supabase, unit, customer, extraction, upcoming, services, locale })

  // Staleness check (debounce sem migration nova): se já existe uma
  // mensagem inbound mais nova que esta pra este cliente, outra mensagem
  // chegou quase junto e já vai processar vendo AMBAS no histórico — para
  // aqui sem gerar/enviar resposta, silenciosamente (não é uma falha).
  if (inboundMessageId && (await isInboundMessageStale(supabase, 'customer_messages', 'customer_id', customer.id, inboundMessageId))) {
    return failed
  }

  const extraContext = [
    appointmentContext
      ? `CONTEXTO DESTA RESPOSTA (ação de agenda já verificada/executada — baseie-se estritamente nisso, nunca contradiga nem invente outro resultado): ${appointmentContext}`
      : '',
    tiAnswerContext,
    handoffTarget && handoffTarget !== 'sales'
      ? 'Você já registrou a verificação deste assunto com o time responsável — diga ao cliente, com naturalidade, que vai confirmar isso e volta com a resposta assim que tiver; você continua sendo quem fala com ele, nunca diga que outra pessoa vai entrar em contato. Se essa MESMA frase ("vou verificar com o time"/equivalente) já apareceu antes no histórico desta conversa sobre este mesmo assunto, NÃO repita — o cliente já ouviu isso, repetir soa como disco riscado. Reconheça em poucas palavras (ex.: "ainda estou verificando isso") ou, se a mensagem dele for só um "ok"/agradecimento/confirmação, responda a ela normalmente sem reabrir a escalação.'
      : '',
    pendingSalesHandoff
      ? `Você já encaminhou esta dúvida para ${sdrPersonaName ?? 'o time comercial'}, que assume a conversa a partir daqui — NÃO tente resolver, verificar ou responder esse assunto você mesma, e NÃO diga "vou verificar com o time" (a pessoa já foi encaminhada, prometer verificação de novo é reprometer algo que não é mais seu). Se o cliente voltar a falar sobre o mesmo assunto, diga com naturalidade que já encaminhou para ${sdrPersonaName ?? 'o time comercial'} e que ele(a) vai falar em breve. Se a mensagem dele for só um "ok"/agradecimento/confirmação, responda normalmente sem reabrir o assunto.`
      : '',
  ]
    .filter(Boolean)
    .join(' ')

  // Fase C: geração da resposta (com decisão de anexo, quando há biblioteca configurada).
  const [attachments, openJobs] = await Promise.all([
    fetchActiveAttachments(supabase, unit, 'receptionist'),
    fetchOpenJobOpenings(supabase, unit),
  ])
  const attachmentsContext = buildAttachmentsContext(attachments)
  const jobOpeningsContext = buildJobOpeningsContext(openJobs)
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
          jobOpeningsContext,
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
        systemPrompt: [basePrompt, extraContext, jobOpeningsContext].filter(Boolean).join(' '),
        history,
      })
    }
  } catch (error) {
    await reportAgentFailure({
      supabase,
      unit,
      contact: { id: customer.id, name: customer.name },
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

  // Grava a linha outbound ANTES de enviar (não depois): a Evolution API
  // pode entregar o eco do próprio envio pelo webhook quase no mesmo
  // instante em que despacha a mensagem, antes mesmo da nossa chamada
  // sendMessage retornar. Se o insert só acontecesse depois, esse eco
  // chegava ao webhook antes de existir uma linha outbound para
  // isRecentOutboundEcho (inbound-router.ts) comparar — o guard falhava
  // silenciosamente (mesma causa raiz corrigida em
  // conversation-engine.ts/processInboundMessage).
  const { data: outboundRow } = await supabase
    .from('customer_messages')
    .insert({
      customer_id: customer.id,
      unit_id: unit.id,
      channel,
      direction: 'outbound',
      content: outgoingText,
      status: 'sent',
      sent_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  try {
    await channelImpl.sendMessage(recipient, outgoingText, {
      voiceReply: wasAudioMessage,
      attachment: attachmentPayload,
      personaName: config.persona_name,
      subject: config.persona_name,
    })
  } catch (error) {
    if (outboundRow) {
      await supabase.from('customer_messages').update({ status: 'failed' }).eq('id', outboundRow.id)
    } else {
      await supabase.from('customer_messages').insert({
        customer_id: customer.id,
        unit_id: unit.id,
        channel,
        direction: 'outbound',
        content: outgoingText,
        status: 'failed',
        sent_at: new Date().toISOString(),
      })
    }
    await reportAgentFailure({
      supabase,
      unit,
      contact: { id: customer.id, name: customer.name },
      source: channel === 'email' ? 'resend' : channel === 'sms' ? 'twilio' : 'evolution',
      eventType: channel === 'email' ? 'resend_send_failed' : channel === 'sms' ? 'twilio_send_failed' : 'evolution_send_failed',
      message: `Falha ao enviar resposta via ${channelLabel(channel)}: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
    })
    return failed
  }

  return { handled: true }
}

// ── Prospecto na linha da Recepcionista (item 4 do pedido) ────────────
//
// Com um número dedicado a ela (migration 051), TODA mensagem que chega
// nessa linha é dela — não só clientes já cadastrados (tabela customers),
// mas franqueado com dúvida operacional, lead interessado em comprar
// franquia, estudante perguntando sobre estágio, etc. Esse público não
// tem cadastro de cliente (criar um em `customers` misturaria "cliente
// pagante" com "quem mandou mensagem uma vez"), então usa o mesmo
// mecanismo de identidade que o resto do produto já usa para contato sem
// cadastro: um `lead` (ver lib/inbound-router.ts Rota 3) — o histórico
// fica em `conversations`, igual ao Sales Rep. Sem agenda (agendamento é
// coisa de cliente cadastrado) e com extração de intenção simplificada
// (só handoff).

export type ReceptionistProspectIntentExtraction = {
  handoff?: 'none' | 'sales' | 'recruiting' | 'human' | 'ti'
  handoff_reason?: string | null
  /** "book" = quer marcar um serviço novo (a única ação de agenda que faz sentido pra quem ainda não é cliente — sem histórico prévio, não há o que remarcar/cancelar/consultar). */
  appointment_action?: 'none' | 'book'
  service_name?: string | null
  /** YYYY-MM-DD, resolvido pelo modelo a partir de linguagem natural — mesma regra do extrator do cliente cadastrado. */
  desired_date?: string | null
  /** HH:MM (24h) */
  desired_time?: string | null
}

function buildProspectIntentExtractorPrompt(params: { unit: Unit; services: Service[]; locale: Locale }): string {
  const { unit, services, locale } = params
  const now = new Date()
  const today = localDateString(now, unit.timezone)
  const weekday = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'pt-BR', {
    weekday: 'long',
    timeZone: unit.timezone,
  }).format(now)
  const servicesList = services.length > 0 ? services.map((s) => s.name).join(', ') : 'nenhum serviço cadastrado'

  return [
    'Você está analisando a ÚLTIMA mensagem de alguém que escreveu para a recepcionista digital de uma empresa, mas que NÃO é um cliente cadastrado — pode ser um cliente novo (primeira vez que fala com a empresa), um franqueado com dúvida operacional, alguém interessado em comprar uma franquia, um estudante perguntando sobre estágio, ou qualquer outro contato. Não escreva a resposta aqui — só extraia a decisão.',
    `Hoje é ${today} (${weekday}), fuso horário ${unit.timezone}. Resolva datas relativas ("amanhã", "sexta que vem", "dia 5") pro formato YYYY-MM-DD com base nisso.`,
    `Serviços que a unidade oferece: ${servicesList}.`,
    'Responda SOMENTE um JSON válido: {"handoff": "none"|"sales"|"recruiting"|"human"|"ti", "handoff_reason": string|null, "appointment_action": "none"|"book", "service_name": string|null, "desired_date": string|null, "desired_time": string|null}.',
    '"handoff" = "sales" quando a pessoa demonstra interesse em comprar/negociar algo que NÃO é simplesmente marcar um dos serviços da lista acima (ex.: comprar uma franquia, fechar um contrato maior, negociar condições especiais); "recruiting" quando pergunta sobre vaga/estágio/trabalhar na empresa; "human" quando é reclamação séria ou algo claramente fora do alcance de uma recepcionista; "ti" quando a pessoa (ex.: um franqueado) tem dúvida sobre como usar ou achar alguma funcionalidade da própria PLATAFORMA ALIZO (o sistema, não o negócio), ou relatou um erro/bug/comportamento estranho do SISTEMA; "none" quando é só uma dúvida geral ou um agendamento (ver abaixo) que você mesma resolve.',
    '"appointment_action" = "book" quando a pessoa quer marcar/agendar um dos serviços da lista acima (isso é rotina — ela é uma cliente nova, não precisa de "sales" nem de handoff nenhum pra isso, você mesma marca); use "service_name" com o nome mais parecido da lista. "desired_date" e "desired_time" só quando ela já deu ou confirmou um dia/horário NESTA mensagem — deixe null se ainda não disse.',
    'Nunca invente um service_name fora da lista acima.',
    'IMPORTANTE: olhe o HISTÓRICO da conversa antes de decidir. Se você (o assistente) já escalou esse MESMO assunto para humano/vendas/recrutamento em uma mensagem anterior recente e a pessoa não trouxe nenhuma informação nova sobre ele (só confirmou, agradeceu, disse "ok", "obrigado", "deu certo" ou repetiu o que já tinha dito), classifique "handoff" como "none" — não escale de novo o que já está escalado.',
  ].join(' ')
}

/**
 * Resolve um pedido de agendamento de quem ainda não é cliente cadastrado.
 * Age exatamente como resolveAppointmentAction faz pro cliente já
 * cadastrado (nunca deixa o modelo "confirmar" algo que não foi de fato
 * verificado/gravado), com uma diferença: só na hora de gravar o
 * agendamento de verdade (endereço já resolvido: serviço + dia + horário
 * livre) é que o cadastro é criado — via provisionCustomerFromLead, pela
 * própria IA, sem nunca pedir pra pessoa "se cadastrar" (item do pedido).
 */
async function resolveProspectAppointmentAction(params: {
  supabase: SupabaseClient
  unit: Unit
  lead: Lead
  contactName: string
  extraction: ReceptionistProspectIntentExtraction
  services: Service[]
  locale: Locale
}): Promise<string | null> {
  const { supabase, unit, lead, contactName, extraction, services, locale } = params
  if ((extraction.appointment_action ?? 'none') !== 'book') return null

  const service = resolveServiceByName(services, extraction.service_name)
  if (!service) {
    return services.length === 0
      ? 'A unidade ainda não tem nenhum serviço cadastrado pra agendar — avise que vai verificar com o time.'
      : 'Não ficou claro qual serviço a pessoa quer agendar — pergunte qual serviço, entre os oferecidos, sem pedir nenhum cadastro.'
  }
  if (!extraction.desired_date) {
    return `A pessoa quer marcar ${service.name} mas não disse o dia — pergunte qual dia prefere, sem pedir nenhum cadastro.`
  }

  const slots = await computeSlotsForService(supabase, unit, service, extraction.desired_date)
  if (!extraction.desired_time) {
    return `Horários livres em ${extraction.desired_date} para ${service.name}: ${listSlotsText(slots, unit, locale)}. Pergunte qual horário ela prefere.`
  }

  const slot = findSlotAtTime(slots, unit, extraction.desired_time)
  if (!slot) {
    return `Horário pedido (${extraction.desired_time}) não está livre em ${extraction.desired_date}. Horários livres nesse dia: ${listSlotsText(slots, unit, locale)}.`
  }

  const customer = await provisionCustomerFromLead(supabase, { lead, unit, contactName })
  if (!customer) {
    return 'Não consegui concluir o agendamento agora (falha ao registrar o cadastro internamente) — diga que vai confirmar em seguida, sem culpar a pessoa por nada.'
  }

  const outcome = await executeBooking(supabase, unit, customer.customerId, service, slot, locale)
  return outcome.context
}

/** Mesma correção de fetchCustomerHistory acima (últimas `limit` mensagens, não as primeiras) — ver comentário lá. */
async function fetchLeadConversationHistory(supabase: SupabaseClient, leadId: string, limit = 20): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('lead_id', leadId)
    .order('sent_at', { ascending: false })
    .limit(limit)

  const rows = ((data as { direction: string; content: string }[] | null) ?? []).reverse()
  return rows.map((row) => ({
    role: row.direction === 'inbound' ? 'user' : 'assistant',
    content: row.content,
  }))
}

export async function processReceptionistProspectInbound(params: {
  supabase: SupabaseClient
  unit: Unit
  lead: Lead
  incomingText: string
  channel: ChannelType
  recipient: string
  wasAudioMessage?: boolean
  /** Id da linha inbound (conversations) que o roteador já inseriu antes de chamar esta função — mesmo staleness check de processReceptionistInbound. */
  inboundMessageId?: string
}): Promise<ProcessReceptionistResult> {
  const { supabase, unit, lead, incomingText, channel, recipient, wasAudioMessage, inboundMessageId } = params
  const failed: ProcessReceptionistResult = { handled: false }
  const contactName = lead.contact_name || lead.company_name

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
      message: `Contato "${contactName}" mandou mensagem na unidade "${unit.name}" mas a Recepcionista está ${config ? 'inativa' : 'sem configuração'} — nenhuma resposta enviada.`,
      orgId: unit.org_id,
      unitId: unit.id,
      leadId: lead.id,
    })
    return failed
  }

  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    await reportAgentFailure({
      supabase,
      unit,
      contact: { id: lead.id, name: contactName },
      source: 'openai',
      eventType: 'missing_env_openai',
      message: 'OPENAI_API_KEY não está configurada — a Recepcionista não consegue gerar respostas.',
    })
    return failed
  }

  const channelImpl = await resolveReceptionistMessagingChannel(supabase, unit, channel)
  if (!channelImpl) {
    await reportAgentFailure({
      supabase,
      unit,
      contact: { id: lead.id, name: contactName },
      source: channel === 'email' ? 'resend' : channel === 'sms' ? 'twilio' : 'evolution',
      eventType: channel === 'email' ? 'missing_env_resend' : channel === 'sms' ? 'missing_env_twilio' : 'missing_env_evolution',
      message: `Canal ${channelLabel(channel)} não configurado para a unidade "${unit.name}" — a Recepcionista não consegue responder.`,
    })
    return failed
  }

  const locale = unitDefaultLocale(unit)

  const [history, organizationProfile, services] = await Promise.all([
    fetchLeadConversationHistory(supabase, lead.id),
    fetchOrganizationBusinessProfile(supabase, unit.org_id),
    loadActiveServices(supabase, unit),
  ])

  const extraction = await generateStructuredReply<ReceptionistProspectIntentExtraction>({
    apiKey,
    systemPrompt: buildProspectIntentExtractorPrompt({ unit, services, locale }),
    history,
    maxTokens: 300,
  }).catch((error) => {
    console.error(`[receptionist_engine] extração de intenção (prospecto) falhou: ${error instanceof Error ? error.message : String(error)}`)
    return {} as ReceptionistProspectIntentExtraction
  })

  const rawHandoff = extraction.handoff ?? 'none'
  let handoffTarget: HandoffTarget | null = null
  let tiAnswerContext = ''

  if (rawHandoff === 'ti') {
    try {
      const tiResult = await answerTechSupportQuestion(supabase, { unit, question: incomingText })
      tiAnswerContext = `CONTEXTO DESTA RESPOSTA (TI interno já verificou e respondeu${tiResult.filedIncident ? '; um chamado técnico já foi registrado para o time' : ''} — baseie sua resposta à pessoa estritamente nisso, com naturalidade, sem inventar nada além disso): ${tiResult.answer}`
    } catch (error) {
      console.error(`[receptionist_engine] TI interno falhou ao responder (prospecto): ${error instanceof Error ? error.message : String(error)}`)
      handoffTarget = 'human'
    }
  } else if (rawHandoff !== 'none') {
    handoffTarget = rawHandoff
  }

  let pendingSalesHandoff = false
  let sdrPersonaName: string | null = null

  if (handoffTarget) {
    const contact = { name: contactName, phone: lead.phone, email: lead.email }
    const alreadyEscalated = await hasRecentEventForContact(supabase, {
      eventType: `receptionist_handoff_${handoffTarget}`,
      unitId: unit.id,
      contactId: lead.id,
      windowMinutes: HANDOFF_COOLDOWN_MINUTES,
    })
    const reasonText =
      extraction.handoff_reason?.trim() ||
      (rawHandoff === 'ti' ? 'TI interno falhou ao responder a dúvida sobre a plataforma' : 'assunto fora do escopo da recepcionista')
    if (!alreadyEscalated) {
      await notifyReceptionistHandoff(supabase, {
        unit,
        contact,
        contactId: lead.id,
        target: handoffTarget,
        reason: reasonText,
        lastMessage: incomingText,
      })
      if (handoffTarget === 'sales') {
        await handoffToSales(supabase, { unit, contact, history, reason: reasonText, fromPersonaName: config.persona_name })
      }
    }
    if (handoffTarget === 'sales') pendingSalesHandoff = true
  }

  // Continuidade pós-handoff pro Sales — mesma razão de processReceptionistInbound acima.
  if (!pendingSalesHandoff) {
    pendingSalesHandoff = await hasRecentEventForContact(supabase, {
      eventType: 'receptionist_handoff_sales',
      unitId: unit.id,
      contactId: lead.id,
      windowMinutes: HANDOFF_COOLDOWN_MINUTES,
    })
  }
  if (pendingSalesHandoff) {
    const { data: sdrConfigRow } = await supabase
      .from('agent_configs')
      .select('persona_name')
      .eq('unit_id', unit.id)
      .eq('agent_type', 'sdr')
      .maybeSingle()
    sdrPersonaName = (sdrConfigRow as { persona_name: string } | null)?.persona_name ?? null
  }

  const appointmentContext = await resolveProspectAppointmentAction({ supabase, unit, lead, contactName, extraction, services, locale })

  // Staleness check — mesma razão de processReceptionistInbound acima.
  if (inboundMessageId && (await isInboundMessageStale(supabase, 'conversations', 'lead_id', lead.id, inboundMessageId))) {
    return failed
  }

  const extraContext = [
    'Esta pessoa NÃO é uma cliente cadastrada ainda — pode ser uma cliente nova falando pela primeira vez, um franqueado com dúvida operacional, um lead interessado em comprar franquia, um estudante perguntando sobre estágio ou qualquer outro contato. Ajude como puder; tente resolver de verdade primeiro usando o que já está disponível (materiais/links, vagas abertas, agenda). Se não conseguir resolver sozinha, NÃO prometa que você mesma vai "verificar", "buscar" ou "trazer novidades depois" — isso não é algo que você controla; em vez disso, sinalize para o time responsável (handoff) e diga que alguém do time vai retornar. Nunca deixe a pessoa sem resposta nenhuma.',
    'NUNCA peça para a pessoa "se cadastrar", "fazer um cadastro" ou enviar dados pessoais (nome, e-mail, telefone) para virar cliente formalmente ou pra "registrar o interesse dela" — isso não é uma ação que você peça pra ela fazer. Antes de pedir qualquer dado pessoal, verifique se já existe um link/material pronto (ver MATERIAIS DISPONÍVEIS PARA ENVIAR e VAGAS ABERTAS PARA CANDIDATURA abaixo, quando existirem) que resolve o pedido dela diretamente — se existir, envie-o em vez de coletar dado nenhum. Se ela quiser marcar um serviço, você mesma agenda na conversa (ver instrução abaixo), sem burocracia nenhuma da parte dela.',
    appointmentContext
      ? `CONTEXTO DESTA RESPOSTA (ação de agenda já verificada/executada — baseie-se estritamente nisso, nunca contradiga nem invente outro resultado): ${appointmentContext}`
      : '',
    tiAnswerContext,
    handoffTarget && handoffTarget !== 'sales'
      ? 'Você já registrou a verificação deste assunto com o time responsável — diga à pessoa, com naturalidade, que vai confirmar isso e volta com a resposta assim que tiver; você continua sendo quem fala com ela, nunca diga que outra pessoa vai entrar em contato. Se essa MESMA frase ("vou verificar com o time"/equivalente) já apareceu antes no histórico desta conversa sobre este mesmo assunto, NÃO repita — a pessoa já ouviu isso, repetir soa como disco riscado. Reconheça em poucas palavras (ex.: "ainda estou verificando isso") ou, se a mensagem dela for só um "ok"/agradecimento/confirmação, responda a ela normalmente sem reabrir a escalação.'
      : '',
    pendingSalesHandoff
      ? `Você já encaminhou esta dúvida para ${sdrPersonaName ?? 'o time comercial'}, que assume a conversa a partir daqui — NÃO tente resolver, verificar ou responder esse assunto você mesma, e NÃO diga "vou verificar com o time" (a pessoa já foi encaminhada). Se ela voltar a falar sobre o mesmo assunto, diga com naturalidade que já encaminhou para ${sdrPersonaName ?? 'o time comercial'} e que ele(a) vai falar em breve. Se a mensagem dela for só um "ok"/agradecimento/confirmação, responda normalmente sem reabrir o assunto.`
      : '',
  ]
    .filter(Boolean)
    .join(' ')

  const [attachments, openJobs] = await Promise.all([
    fetchActiveAttachments(supabase, unit, 'receptionist'),
    fetchOpenJobOpenings(supabase, unit),
  ])
  const attachmentsContext = buildAttachmentsContext(attachments)
  const jobOpeningsContext = buildJobOpeningsContext(openJobs)
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
          jobOpeningsContext,
          'Responda SOMENTE um JSON válido: {"reply": string, "attachment_id": string|null}. O campo "reply" é a mensagem normal que você mandaria, seguindo à risca as regras de tom, tamanho e idioma já combinadas acima. O campo "attachment_id" é o id do material a enviar agora (ver MATERIAIS DISPONÍVEIS PARA ENVIAR acima), ou null se nenhum se aplica a esta mensagem.',
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
        systemPrompt: [basePrompt, extraContext, jobOpeningsContext].filter(Boolean).join(' '),
        history,
      })
    }
  } catch (error) {
    await reportAgentFailure({
      supabase,
      unit,
      contact: { id: lead.id, name: contactName },
      source: 'openai',
      eventType: 'openai_api_error',
      message: `Falha na OpenAI ao gerar resposta da Recepcionista: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
    })
    return failed
  }

  if (!reply) return failed

  let outgoingText = reply
  let attachmentPayload: AttachmentToSend | undefined
  if (chosenAttachment) {
    if (chosenAttachment.kind === 'link' || channel === 'sms') {
      outgoingText = `${reply}\n\n${chosenAttachment.title}: ${chosenAttachment.file_url}`
    } else {
      attachmentPayload = { title: chosenAttachment.title, url: chosenAttachment.file_url, fileName: chosenAttachment.file_name }
    }
  }

  // Grava a linha outbound ANTES de enviar — mesma razão do comentário em
  // processReceptionistInbound acima (fecha a corrida com o eco da
  // Evolution API para isRecentOutboundEcho).
  const { data: outboundRow } = await supabase
    .from('conversations')
    .insert({
      lead_id: lead.id,
      unit_id: unit.id,
      channel,
      direction: 'outbound',
      content: outgoingText,
      status: 'sent',
      sent_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  try {
    await channelImpl.sendMessage(recipient, outgoingText, {
      voiceReply: wasAudioMessage,
      attachment: attachmentPayload,
      personaName: config.persona_name,
      subject: config.persona_name,
    })
  } catch (error) {
    if (outboundRow) {
      await supabase.from('conversations').update({ status: 'failed' }).eq('id', outboundRow.id)
    } else {
      await supabase.from('conversations').insert({
        lead_id: lead.id,
        unit_id: unit.id,
        channel,
        direction: 'outbound',
        content: outgoingText,
        status: 'failed',
        sent_at: new Date().toISOString(),
      })
    }
    await reportAgentFailure({
      supabase,
      unit,
      contact: { id: lead.id, name: contactName },
      source: channel === 'email' ? 'resend' : channel === 'sms' ? 'twilio' : 'evolution',
      eventType: channel === 'email' ? 'resend_send_failed' : channel === 'sms' ? 'twilio_send_failed' : 'evolution_send_failed',
      message: `Falha ao enviar resposta via ${channelLabel(channel)}: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
    })
    return failed
  }

  return { handled: true }
}
