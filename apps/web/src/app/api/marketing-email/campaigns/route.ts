import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { getOpenAIApiKey } from '@/lib/openai'
import { generateCampaignCopy, type CampaignSourceContent } from '@/lib/marketing-email/generator'
import type { AudienceFilter, CampaignAudienceType, CampaignSourceType } from '@/lib/marketing-email/types'
import type { Unit } from '@/lib/types'

export const maxDuration = 60

const AUDIENCE_TYPES: CampaignAudienceType[] = ['leads', 'customers', 'both']
const SOURCE_TYPES: CampaignSourceType[] = ['objective', 'content_post', 'seo_content_item']

function sanitizeAudienceFilter(input: unknown): AudienceFilter {
  const raw = (input ?? {}) as Record<string, unknown>
  const filter: AudienceFilter = {}
  if (Array.isArray(raw.lead_statuses)) {
    const statuses = raw.lead_statuses.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    if (statuses.length > 0) filter.lead_statuses = statuses
  }
  if (typeof raw.stale_days === 'number' && raw.stale_days > 0) filter.stale_days = Math.floor(raw.stale_days)
  if (raw.customer_status === 'active' || raw.customer_status === 'inactive' || raw.customer_status === 'all') {
    filter.customer_status = raw.customer_status
  }
  return filter
}

/**
 * Cria o rascunho de uma campanha de e-mail marketing: a IA já gera
 * assunto+corpo prontos (mesmo espírito de content_posts/seo_content_items),
 * a campanha nasce em 'pending_approval' — nunca dispara sozinha.
 *
 * Body:
 *   unit_id: string
 *   audience_type: 'leads' | 'customers' | 'both'
 *   audience_filter?: { lead_statuses?, stale_days?, customer_status? }
 *   objective?: string — obrigatório quando não há source (ou como instrução extra com source)
 *   source_type?: 'content_post' | 'seo_content_item'
 *   source_id?: string — obrigatório quando source_type é informado
 *
 * Permissão: a leitura da unidade abaixo já usa a sessão (RLS); a
 * geração em si é só chamada de IA (sem gravação). O INSERT no fim passa
 * pela sessão também — a RLS (can_access_unit + is_org_admin) barra quem
 * não pode.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: {
    unit_id?: string
    audience_type?: string
    audience_filter?: unknown
    objective?: string
    source_type?: string
    source_id?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  if (!body.unit_id || typeof body.unit_id !== 'string') {
    return NextResponse.json({ error: 'unit_id é obrigatório.' }, { status: 400 })
  }
  if (!body.audience_type || !AUDIENCE_TYPES.includes(body.audience_type as CampaignAudienceType)) {
    return NextResponse.json({ error: "audience_type deve ser 'leads', 'customers' ou 'both'." }, { status: 400 })
  }
  const sourceType: CampaignSourceType =
    body.source_type && SOURCE_TYPES.includes(body.source_type as CampaignSourceType)
      ? (body.source_type as CampaignSourceType)
      : 'objective'
  if (sourceType !== 'objective' && (!body.source_id || typeof body.source_id !== 'string')) {
    return NextResponse.json({ error: 'source_id é obrigatório quando source_type é informado.' }, { status: 400 })
  }
  const objective = typeof body.objective === 'string' ? body.objective.trim() : ''
  if (sourceType === 'objective' && !objective) {
    return NextResponse.json({ error: 'Descreva o objetivo da campanha (ex.: "avisar sobre promoção").' }, { status: 400 })
  }

  const { data: unitData } = await supabase.from('units').select('*').eq('id', body.unit_id).maybeSingle()
  if (!unitData) return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  const unit = unitData as Unit
  if (!unit.org_id) return NextResponse.json({ error: 'Unidade sem organização vinculada.' }, { status: 400 })

  let source: CampaignSourceContent | null = null
  if (sourceType === 'content_post') {
    const { data } = await supabase.from('content_posts').select('caption, unit_id').eq('id', body.source_id).maybeSingle()
    if (!data || data.unit_id !== unit.id) {
      return NextResponse.json({ error: 'Post de conteúdo não encontrado para esta unidade.' }, { status: 404 })
    }
    source = { title: 'Post de conteúdo/social', text: data.caption }
  } else if (sourceType === 'seo_content_item') {
    const { data } = await supabase
      .from('seo_content_items')
      .select('title, body_markdown, unit_id')
      .eq('id', body.source_id)
      .maybeSingle()
    if (!data || data.unit_id !== unit.id) {
      return NextResponse.json({ error: 'Conteúdo de SEO não encontrado para esta unidade.' }, { status: 404 })
    }
    source = { title: data.title, text: data.body_markdown }
  }

  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY não está configurada.' }, { status: 500 })
  }

  const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unit.org_id)

  let generated
  try {
    generated = await generateCampaignCopy({ apiKey, unit, organizationProfile, objective, source })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Falha ao gerar a campanha.' },
      { status: 502 },
    )
  }

  const audienceFilter = sanitizeAudienceFilter(body.audience_filter)

  const { data: campaign, error } = await supabase
    .from('marketing_campaigns')
    .insert({
      org_id: unit.org_id,
      unit_id: unit.id,
      objective,
      subject: generated.subject,
      body_text: generated.bodyText,
      reasoning: generated.reasoning,
      source_type: sourceType,
      source_id: sourceType === 'objective' ? null : body.source_id,
      audience_type: body.audience_type,
      audience_filter: audienceFilter,
      status: 'pending_approval',
    })
    .select('*')
    .single()

  if (error) {
    const isPermissionError = error.code === '42501'
    return NextResponse.json(
      { error: isPermissionError ? 'Só administradores da organização podem criar campanhas.' : error.message },
      { status: isPermissionError ? 403 : 500 },
    )
  }

  return NextResponse.json({ campaign })
}
