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
