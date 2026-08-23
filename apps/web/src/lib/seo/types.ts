// Tipos do funcionário digital de SEO (migration 042).

export type SeoCheckStatus = 'pass' | 'warning' | 'fail'

export type SeoCheck = {
  id: string
  label: string
  status: SeoCheckStatus
  message: string
  recommendation: string
}

export type SeoAudit = {
  id: string
  org_id: string
  unit_id: string
  site_url: string
  score: number
  checks: SeoCheck[]
  error_message: string | null
  created_at: string
}

export type SeoContentType = 'blog' | 'landing_page' | 'gbp_description' | 'gbp_post'
export type SeoContentStatus = 'pending_approval' | 'approved' | 'rejected'

export type SeoContentItem = {
  id: string
  org_id: string
  unit_id: string
  content_type: SeoContentType
  status: SeoContentStatus
  target_keyword: string | null
  title: string
  meta_description: string | null
  body_markdown: string
  image_prompt: string | null
  image_url: string | null
  reasoning: string
  decided_by: string | null
  created_at: string
  updated_at: string
}

export type SeoKeyword = {
  id: string
  org_id: string
  unit_id: string
  keyword: string
  target_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type SeoKeywordRanking = {
  id: string
  org_id: string
  unit_id: string
  keyword_id: string
  position: number | null
  checked_at: string
}

export type SeoGbpChecklistState = {
  id: string
  org_id: string
  unit_id: string
  item_key: string
  is_done: boolean
  updated_at: string
}

export type SeoSearchConsoleConnectionStatus = 'connected' | 'error' | 'disconnected'

export type SeoSearchConsoleAccount = {
  id: string
  org_id: string
  unit_id: string
  site_url: string
  refresh_token: string
  access_token: string | null
  token_expires_at: string | null
  connection_status: SeoSearchConsoleConnectionStatus
  connection_error: string | null
  connected_at: string
  created_at: string
  updated_at: string
}

export type SeoGscOAuthSession = {
  id: string
  org_id: string
  unit_id: string
  site_urls: string[]
  refresh_token: string
  access_token: string
  expires_at: string
  created_at: string
}

export type SeoSearchConsoleQuery = { query: string; clicks: number; impressions: number; ctr: number; position: number }

export type SeoSearchConsoleSnapshot = {
  id: string
  org_id: string
  unit_id: string
  period_start: string
  period_end: string
  total_clicks: number
  total_impressions: number
  avg_ctr: number
  avg_position: number
  top_queries: SeoSearchConsoleQuery[]
  created_at: string
}
