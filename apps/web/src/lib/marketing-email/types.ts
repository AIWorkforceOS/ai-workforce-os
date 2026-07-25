// Tipos do e-mail marketing em massa (campanha/newsletter), migration 043.
// Distinto do e-mail 1:1 do Sales Rep (lib/email.ts:sendLeadEmail).

export type CampaignAudienceType = 'leads' | 'customers' | 'both'
export type CampaignSourceType = 'objective' | 'content_post' | 'seo_content_item'
export type CampaignStatus = 'pending_approval' | 'approved' | 'rejected' | 'sending' | 'sent' | 'failed'

export type CustomerAudienceStatus = 'active' | 'inactive' | 'all'

/** audience_filter (jsonb) — critérios de segmentação, todos opcionais. */
export type AudienceFilter = {
  /** Só relevante quando audience_type inclui 'leads'. Vazio/ausente = todos os status. */
  lead_statuses?: string[]
  /** Só relevante quando audience_type inclui 'leads'. Inclui quem nunca foi contatado. Null/ausente = sem filtro de tempo. */
  stale_days?: number | null
  /** Só relevante quando audience_type inclui 'customers'. Default 'active'. */
  customer_status?: CustomerAudienceStatus
}

export type MarketingCampaign = {
  id: string
  org_id: string
  unit_id: string
  objective: string
  subject: string
  body_text: string
  source_type: CampaignSourceType
  source_id: string | null
  audience_type: CampaignAudienceType
  audience_filter: AudienceFilter
  status: CampaignStatus
  reasoning: string
  recipients_total: number
  recipients_sent: number
  recipients_failed: number
  recipients_skipped: number
  error_message: string | null
  decided_by: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

export type CampaignRecipientType = 'lead' | 'customer'
export type CampaignRecipientStatus = 'pending' | 'sent' | 'failed' | 'skipped_opt_out' | 'skipped_no_email'

export type MarketingCampaignRecipient = {
  id: string
  campaign_id: string
  unit_id: string
  recipient_type: CampaignRecipientType
  recipient_id: string
  email: string
  status: CampaignRecipientStatus
  error_message: string | null
  sent_at: string | null
  created_at: string
}

/** Linha mínima de `leads` necessária para seleção de audiência (lib/marketing-email/audience.ts). */
export type AudienceLeadRow = {
  id: string
  email: string | null
  status: string
  last_contacted_at: string | null
  marketing_opt_out: boolean
  unsubscribe_token: string
}

/** Linha mínima de `customers` necessária para seleção de audiência. */
export type AudienceCustomerRow = {
  id: string
  email: string | null
  status: string
  marketing_opt_out: boolean
  unsubscribe_token: string
}
