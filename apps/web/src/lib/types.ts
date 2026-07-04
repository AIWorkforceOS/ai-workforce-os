export type Unit = {
  id: string
  org_id: string | null
  name: string
  slug: string
  whatsapp_instance_id: string | null
  whatsapp_phone: string | null
  email_from: string | null
  email_reply_to: string | null
  region_city: string | null
  region_state: string | null
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
