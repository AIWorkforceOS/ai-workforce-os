// Tipos do funcionário digital de Conteúdo/Social (migration 040).

export type SocialPlatform = 'instagram' | 'facebook'
export type SocialConnectionStatus = 'pending_credentials' | 'connected' | 'error' | 'disconnected'
export type PublishingMode = 'suggestion' | 'autonomous'

/** Página do Facebook conectada (+ conta Business do Instagram vinculada, quando existir). */
export type SocialAccount = {
  id: string
  org_id: string
  unit_id: string
  platform: 'meta'
  page_id: string
  page_name: string
  page_access_token: string | null
  instagram_business_account_id: string | null
  instagram_username: string | null
  connection_status: SocialConnectionStatus
  connection_error: string | null
  publishing_mode: PublishingMode
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Uma Página candidata trazida por GET /me/accounts durante o login com Facebook (Fase OAuth, 2026-08-22). */
export type OAuthCandidatePage = {
  id: string
  name: string
  access_token: string
  instagram_business_account_id: string | null
  instagram_username: string | null
}

/** content_oauth_sessions — só existe entre o callback do OAuth e a escolha da Página, quando o cliente administra mais de uma. */
export type ContentOAuthSession = {
  id: string
  org_id: string
  unit_id: string
  pages: OAuthCandidatePage[]
  expires_at: string
  created_at: string
}

export type ContentPostStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'rejected'
  | 'failed'

/** Post gerado (legenda + imagem) na fila/calendário de conteúdo. */
export type ContentPost = {
  id: string
  org_id: string
  unit_id: string
  social_account_id: string
  platform: SocialPlatform
  status: ContentPostStatus
  content_pillar: string | null
  visual_angle: string | null
  caption: string
  image_prompt: string | null
  image_url: string | null
  reasoning: string
  mode: PublishingMode
  scheduled_for: string | null
  published_at: string | null
  external_post_id: string | null
  error_message: string | null
  decided_by: string | null
  created_at: string
  updated_at: string
}
