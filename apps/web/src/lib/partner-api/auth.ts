import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import type { Unit } from '@/lib/types'

// API de parceiro (/api/partner/v1): autenticação por chave Bearer com
// escopos, isolada por organização (e opcionalmente por unidade).
// Formato da chave: alz_live_<8 hex de prefixo>_<segredo base64url de 32 bytes>.
// Só o hash SHA-256 é guardado (partner_api_keys.key_hash); como o segredo
// tem 256 bits de entropia, hash simples sem sal é suficiente e permite
// buscar a chave por igualdade.

export const PARTNER_SCOPES = [
  'units:read',
  'units:write',
  'whatsapp:manage',
  'leads:read',
  'leads:write',
  'messages:read',
  'messages:send',
  'prospecting:run',
  'prospecting:write',
  'jobs:read',
  'jobs:write',
  'events:read',
  'webhooks:manage',
  'metrics:read',
  'template:manage',
] as const

export type PartnerScope = (typeof PARTNER_SCOPES)[number]

export function isPartnerScope(value: unknown): value is PartnerScope {
  return typeof value === 'string' && (PARTNER_SCOPES as readonly string[]).includes(value)
}

export function hashPartnerKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function generatePartnerKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(4).toString('hex')
  const secret = randomBytes(32).toString('base64url')
  const key = `alz_live_${prefix}_${secret}`
  return { key, prefix: `alz_live_${prefix}`, hash: hashPartnerKey(key) }
}

export type PartnerContext = {
  supabase: SupabaseClient
  keyId: string
  orgId: string
  /** null = todas as unidades da organização */
  unitId: string | null
  scopes: string[]
}

type KeyRow = {
  id: string
  org_id: string
  unit_id: string | null
  scopes: string[] | null
  revoked_at: string | null
  expires_at: string | null
  last_used_at: string | null
}

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 120
// Best-effort em memória por instância (mesmo padrão de /api/public/lead-intake);
// não é garantia distribuída entre instâncias serverless.
const rateHits = new Map<string, number[]>()

export function isPartnerRateLimited(keyId: string, now = Date.now()): boolean {
  const hits = (rateHits.get(keyId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  hits.push(now)
  rateHits.set(keyId, hits)
  return hits.length > RATE_LIMIT_MAX_REQUESTS
}

export function partnerError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status })
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/**
 * Autentica a requisição e confere o escopo exigido. Devolve o contexto do
 * parceiro ou uma NextResponse de erro pronta (401/403/429/500).
 * `supabaseOverride` existe só para testes.
 */
export async function authenticatePartner(
  request: Request,
  requiredScope: PartnerScope,
  supabaseOverride?: SupabaseClient,
): Promise<PartnerContext | NextResponse> {
  const header = request.headers.get('authorization') ?? ''
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!key.startsWith('alz_live_')) {
    return partnerError(401, 'Chave de API ausente ou inválida.')
  }

  const supabase = supabaseOverride ?? createServiceClient()
  if (!supabase) return partnerError(500, 'Serviço não configurado.')

  const hash = hashPartnerKey(key)
  const { data } = await supabase
    .from('partner_api_keys')
    .select('id, org_id, unit_id, scopes, revoked_at, expires_at, last_used_at, key_hash')
    .eq('key_hash', hash)
    .maybeSingle()

  const row = data as (KeyRow & { key_hash: string }) | null
  if (!row || !safeEqual(row.key_hash, hash)) {
    return partnerError(401, 'Chave de API ausente ou inválida.')
  }
  if (row.revoked_at) return partnerError(401, 'Chave de API revogada.')
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return partnerError(401, 'Chave de API expirada.')
  }

  if (isPartnerRateLimited(row.id)) {
    return partnerError(429, 'Muitas requisições. Tente novamente em instantes.')
  }

  const scopes = row.scopes ?? []
  if (!scopes.includes(requiredScope)) {
    return partnerError(403, `Esta chave não tem o escopo "${requiredScope}".`)
  }

  // Atualiza last_used_at no máximo 1x/min por chave (evita escrita a cada request).
  const lastUsed = row.last_used_at ? new Date(row.last_used_at).getTime() : 0
  if (Date.now() - lastUsed > 60_000) {
    await supabase.from('partner_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id)
  }

  return { supabase, keyId: row.id, orgId: row.org_id, unitId: row.unit_id, scopes }
}

export function isPartnerContext(value: PartnerContext | NextResponse): value is PartnerContext {
  return !(value instanceof NextResponse)
}

/**
 * Resolve uma unidade (por id OU slug) respeitando o isolamento da chave:
 * a unidade precisa ser da mesma organização e, se a chave for restrita a
 * uma unidade, ser exatamente ela. Devolve null para qualquer violação (o
 * chamador responde 404 — não revela se a unidade existe em outra org).
 */
export async function resolvePartnerUnit(
  ctx: PartnerContext,
  ref: { unitId?: unknown; unitSlug?: unknown },
): Promise<Unit | null> {
  const id = typeof ref.unitId === 'string' && ref.unitId ? ref.unitId : null
  const slug = typeof ref.unitSlug === 'string' && ref.unitSlug ? ref.unitSlug : null
  // Chave restrita a uma unidade: se nada foi informado, assume a própria.
  const effectiveId = id ?? (slug ? null : ctx.unitId)
  if (!effectiveId && !slug) return null

  let query = ctx.supabase.from('units').select('*').eq('org_id', ctx.orgId)
  query = effectiveId ? query.eq('id', effectiveId) : query.eq('slug', slug as string)
  const { data } = await query.maybeSingle()
  const unit = data as Unit | null
  if (!unit || unit.is_active === false) return null
  if (ctx.unitId && unit.id !== ctx.unitId) return null
  return unit
}

/** Ids das unidades que a chave enxerga (para listagens). */
export async function listPartnerUnitIds(ctx: PartnerContext): Promise<string[]> {
  if (ctx.unitId) return [ctx.unitId]
  const { data } = await ctx.supabase.from('units').select('id').eq('org_id', ctx.orgId)
  return ((data as { id: string }[] | null) ?? []).map((u) => u.id)
}
