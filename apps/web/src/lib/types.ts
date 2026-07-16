import type { Locale } from '@/lib/i18n/config'

export type MessagingChannelType = 'whatsapp' | 'sms'

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
  is_active: boolean
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
  created_at: string
  updated_at: string
}
