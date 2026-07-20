import type { Locale } from '@/lib/i18n/config'

export type MessagingChannelType = 'whatsapp' | 'sms'

// ------------------------------------------------------------
// Agenda Inteligente (Fase 2, migration 026)
// ------------------------------------------------------------

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

/** Janela de horário no fuso da unidade, formato 'HH:MM' 24h. */
export type TimeInterval = { start: string; end: string }

/**
 * Grade semanal usada em units.business_hours e employees.availability.
 * Dia ausente ou com array vazio = fechado/indisponível naquele dia.
 * Jsonb vazio ({}) = nunca configurado — use os accessors de
 * lib/scheduling.ts, que aplicam defaults sensatos.
 */
export type WeeklySchedule = Partial<Record<Weekday, TimeInterval[]>>

/** Configuração de agenda da unidade (units.scheduling_settings). No banco o jsonb pode estar vazio/parcial — use getSchedulingSettings() para obter todos os campos preenchidos. */
export type SchedulingSettings = {
  /** granularidade dos slots ofertados, em minutos */
  slot_interval_minutes: number
  /** antecedência mínima para criar um agendamento, em minutos */
  min_notice_minutes: number
  /** horizonte máximo de agendamento, em dias */
  max_advance_days: number
  /** quantas horas antes do horário o lembrete automático é enviado */
  reminder_hours_before: number
  /** envia mensagem automática de confirmação ao criar o agendamento */
  confirmation_enabled: boolean
  /** envia lembrete automático antes do horário */
  reminders_enabled: boolean
}

export type Unit = {
  id: string
  org_id: string | null
  name: string
  slug: string
  whatsapp_instance_id: string | null
  whatsapp_phone: string | null
  email_from: string | null
  email_reply_to: string | null
  /** URL pública da logo da unidade (Supabase Storage, bucket unit-logos), usada no template de e-mail do Sales Rep. */
  logo_url: string | null
  region_city: string | null
  region_state: string | null
  evolution_api_url: string | null
  evolution_api_key: string | null
  evolution_instance_name: string | null
  /** Canal de mensagens escolhido pela unidade. Null = padrão histórico (whatsapp). */
  messaging_channel: MessagingChannelType | null
  twilio_account_sid: string | null
  twilio_auth_token: string | null
  twilio_phone_number: string | null
  /** Idioma padrão de atendimento da unidade. Null = padrão histórico (pt). */
  default_conversation_language: Locale | null
  intake_token: string | null
  /** native = CRM próprio do Alizo (padrão). smarter = leads também são espelhados no CRM de parceiros da Smarter (migration 018). */
  crm_integration_mode: 'native' | 'smarter'
  /** Token de parceiro (Bearer) da API de CRM da Smarter para esta unidade — segredo. Só usado quando crm_integration_mode = 'smarter'. */
  smarter_crm_partner_token: string | null
  /** native = pipeline de recrutamento próprio do Alizo (padrão). smarter = vagas/candidatos também são publicados no sistema de vagas da Smarter (migration 019). */
  recruiting_integration_mode: 'native' | 'smarter'
  /** Token de parceiro (Bearer) das rotas de vagas/candidaturas da Smarter para esta unidade — segredo. Só usado quando recruiting_integration_mode = 'smarter'. */
  smarter_recruiting_partner_token: string | null
  /** id da Company desta unidade no Sistema Smarter — obrigatório para publicar vaga (POST /api/partners/vacancies companyId). Sem ele a integração fica incompleta mesmo com token configurado. */
  smarter_recruiting_company_id: string | null
  /** Token de parceiro (Bearer, escopo marketing) da API de campanhas da Smarter para esta unidade — segredo. Presente = o cron do Traffic Specialist espelha campanhas via lib/traffic/smarter-campaigns.ts (migration 023). Null = sem espelhamento, comportamento atual. */
  smarter_marketing_partner_token: string | null
  /** Token público de baixo risco para POST /api/public/lead-intake (migration 022) — cria lead simples e dispara o primeiro contato, sem login de usuário. Não confundir com os tokens de parceiro acima (direção oposta: aqui é fonte externa escrevendo no Alizo). */
  public_lead_intake_token: string | null
  /** Fuso IANA da unidade (migration 026). Todos os horários de agenda são interpretados neste fuso. */
  timezone: string
  /** Grade semanal de funcionamento (migration 026). Vazio = default de getBusinessHours(). */
  business_hours: WeeklySchedule
  /** Configuração de agenda (migration 026), possivelmente vazia/parcial no banco. Use getSchedulingSettings(). */
  scheduling_settings: Partial<SchedulingSettings>
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Colaborador humano da unidade (tabela employees, migration 004; campos de agenda na 026). */
export type Employee = {
  id: string
  org_id: string | null
  unit_id: string | null
  name: string
  email: string | null
  phone: string | null
  /** admin | manager | staff | sdr | support */
  role: string
  is_active: boolean
  /** true = aparece como profissional atendendo agenda (migration 026) */
  is_schedulable: boolean
  /** grade semanal de disponibilidade (migration 026). Vazio = segue o horário da unidade. */
  availability: WeeklySchedule
  created_at: string
  updated_at: string
}

export type DashboardSummaryRow = {
  org_id: string | null
  org_name: string | null
  unit_id: string | null
  unit_name: string | null
  region_city: string | null
  region_state: string | null
  total_leads: number
  new_leads: number
  active_leads: number
  won_leads: number
  total_conversations: number
  conversations_today: number
}

export type AgentTone = 'professional' | 'friendly' | 'formal'

export type ActiveHours = {
  start: string
  end: string
  days: number[]
}

export type InterviewStatus = 'pending' | 'in_progress' | 'completed'

export type InterviewTranscriptEntry = {
  role: 'user' | 'assistant'
  content: string
  /** true quando esta mensagem do agente foi a pergunta final obrigatória ("tem mais alguma coisa?") */
  asked_final?: boolean
}

/** Correção ensinada pelo dono ao testar o funcionário na tela "Testar Funcionário" (migration 025, sub-etapa 5/7). */
export type TrainingCorrectionEntry = {
  timestamp: string
  /** resumo do momento da simulação em que a correção se aplica (ex.: o que o cliente simulado disse + o que o agente respondeu) */
  context: string
  correction: string
}

export type AgentConfig = {
  id: string
  unit_id: string
  agent_type: string
  persona_name: string
  persona_tone: AgentTone
  daily_limit: number
  active_hours: ActiveHours
  escalation_rules: { after_messages: number; keywords: string[] }
  sectors: string[]
  is_active: boolean
  /** o que o funcionário aprendeu na entrevista de contratação (migration 012) */
  business_profile?: Record<string, unknown> | null
  interview_status?: InterviewStatus | null
  interview_transcript?: InterviewTranscriptEntry[] | null
  /** correções aprendidas testando o funcionário na simulação (migration 025) */
  training_corrections?: TrainingCorrectionEntry[] | null
  created_at: string
  updated_at: string
}

export const SECTOR_OPTIONS = [
  'tecnologia',
  'industria',
  'comercio',
  'servicos',
  'saude',
  'educacao',
] as const

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'replied'
  | 'negotiating'
  | 'won'
  | 'lost'
  | 'paused'

export type Lead = {
  id: string
  unit_id: string
  company_name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  sector: string | null
  city: string | null
  state: string | null
  source: string
  status: LeadStatus
  google_place_id: string | null
  notes: string | null
  last_contacted_at: string | null
  /** dados de vaga levantados pelo Sales Rep na própria conversa ao fechar negócio (migration 013) */
  deal_profile: Record<string, unknown>
  deal_closed_at: string | null
  /** id do CrmLead correspondente no CRM da Smarter, quando a unidade usa crm_integration_mode = 'smarter' (migration 018). */
  smarter_crm_lead_id: string | null
  created_at: string
  updated_at: string
}

export type CustomerStatus = 'active' | 'inactive'

export type Customer = {
  id: string
  org_id: string
  unit_id: string
  /** lead de origem quando o cliente veio do fechamento do Sales Rep (migration 024) */
  lead_id: string | null
  name: string
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  status: CustomerStatus
  tags: string[]
  source: string
  notes: string | null
  /** campos dinâmicos por segmento de negócio (ex.: quartos/banheiros em cleaning) — schema em lib/verticals/catalog.ts (migration 025) */
  custom_fields: Record<string, unknown>
  created_at: string
  updated_at: string
}

/** Serviço agendável da unidade (tabela services, migration 026). */
export type Service = {
  id: string
  org_id: string
  unit_id: string
  name: string
  duration_minutes: number
  /** intervalo reservado após o serviço antes do próximo slot */
  buffer_minutes: number
  /** quantos agendamentos simultâneos o mesmo slot comporta */
  capacity_per_slot: number
  price: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ResourceType = 'room' | 'equipment'

/** Sala ou equipamento alocável a um agendamento (tabela resources, migration 026). */
export type Resource = {
  id: string
  org_id: string
  unit_id: string
  type: ResourceType
  name: string
  capacity: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'

/** Agendamento (tabela appointments, migration 026). Na Fase 2 é sempre criado por UI (source = 'manual'); agendamento conversacional pela IA fica pra Fase 3. */
export type Appointment = {
  id: string
  org_id: string
  unit_id: string
  customer_id: string
  service_id: string | null
  employee_id: string | null
  resource_id: string | null
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  cancelled_at: string | null
  cancellation_reason: string | null
  source: string
  notes: string | null
  custom_fields: Record<string, unknown>
  /** preenchidos pelos templates automáticos de comunicação (sub-etapas seguintes da Fase 2) */
  confirmation_sent_at: string | null
  reminder_sent_at: string | null
  created_at: string
  updated_at: string
}

export type WaitlistStatus = 'waiting' | 'notified' | 'converted' | 'removed'

/** Entrada de lista de espera (tabela waitlist_entries, migration 026). Sem matching automático nesta fase — status muda por ação humana na UI. */
export type WaitlistEntry = {
  id: string
  org_id: string
  unit_id: string
  customer_id: string
  service_id: string | null
  preferred_notes: string | null
  status: WaitlistStatus
  notified_at: string | null
  created_at: string
  updated_at: string
}

export type ConversationChannel = 'whatsapp' | 'email' | 'sms'
export type ConversationDirection = 'outbound' | 'inbound'
export type ConversationStatus = 'sent' | 'delivered' | 'read' | 'failed'

export type Conversation = {
  id: string
  lead_id: string
  unit_id: string
  channel: ConversationChannel
  direction: ConversationDirection
  content: string
  template_key: string | null
  external_message_id: string | null
  status: ConversationStatus
  sent_at: string
  created_at: string
}

export type ProspectingJobStatus = 'pending' | 'running' | 'done' | 'failed'

export type ProspectingJob = {
  id: string
  unit_id: string
  city: string
  state: string
  keywords: string[]
  status: ProspectingJobStatus
  total_found: number
  total_new: number
  error_message: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
}

export type Organization = {
  id: string
  name: string
  slug: string
  plan: string
  plan_id: string | null
  monthly_fee: number | null
  billing_day: number
  is_active: boolean
  owner_email: string | null
  /** true só para organizações clientes/franquias da Smarter Estágios — controla se o sourcing usa a API de parceiros da Smarter (lib/recruiter/smarter-api.ts). */
  is_smarter_partner: boolean
  /** Chave do segmento de negócio (ver lib/verticals/catalog.ts), migration 025. Null = ainda não definido. */
  vertical_key: string | null
  /** Ficha da empresa COMPARTILHADA entre todos os AI Employees da organização (migration 025). Distinta de agent_configs.business_profile. */
  business_profile: Record<string, unknown>
  created_at: string
  updated_at: string
}
