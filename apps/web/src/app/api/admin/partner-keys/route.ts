import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { canManageUserAccess } from '@/lib/permissions/user-access'
import { PARTNER_SCOPES, generatePartnerKey } from '@/lib/partner-api/auth'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.enum(PARTNER_SCOPES)).min(1),
  // opcional: restringe a chave a uma unidade (dono de unidade é sempre restrito à própria)
  unitId: z.string().uuid().optional(),
  // super admin precisa informar a organização; admin da empresa usa a própria
  orgId: z.string().uuid().optional(),
  expiresAt: z.string().datetime().optional(),
})

type KeyListRow = {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  unit_id: string | null
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

/** GET /api/admin/partner-keys — chaves da organização (nunca devolve a chave nem o hash). */
export async function GET(request: Request) {
  const actor = await getAppUser()
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!canManageUserAccess(actor)) {
    return NextResponse.json({ error: 'Somente o administrador da empresa gerencia chaves de API.' }, { status: 403 })
  }

  const orgId = actor.isSuperAdmin ? new URL(request.url).searchParams.get('org_id') ?? actor.orgId : actor.orgId
  if (!orgId) return NextResponse.json({ error: 'Organização não informada.' }, { status: 400 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Servidor sem acesso de gravação configurado.' }, { status: 500 })

  let query = service
    .from('partner_api_keys')
    .select('id, name, key_prefix, scopes, unit_id, last_used_at, expires_at, revoked_at, created_at')
    .eq('org_id', orgId)
  if (!actor.isSuperAdmin && actor.unitId) query = query.eq('unit_id', actor.unitId)
  const { data } = await query.order('created_at', { ascending: false })

  return NextResponse.json({ keys: (data as KeyListRow[] | null) ?? [], available_scopes: PARTNER_SCOPES })
}

/**
 * POST /api/admin/partner-keys — cria uma chave. A chave completa é
 * devolvida UMA ÚNICA vez nesta resposta; depois só o prefixo fica visível.
 */
export async function POST(request: Request) {
  const actor = await getAppUser()
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!canManageUserAccess(actor)) {
    return NextResponse.json({ error: 'Somente o administrador da empresa gerencia chaves de API.' }, { status: 403 })
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })

  const orgId = actor.isSuperAdmin ? parsed.data.orgId ?? actor.orgId : actor.orgId
  if (!orgId) return NextResponse.json({ error: 'Organização não informada.' }, { status: 400 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Servidor sem acesso de gravação configurado.' }, { status: 500 })

  // Dono de unidade só cria chave da própria unidade.
  const unitId = !actor.isSuperAdmin && actor.unitId ? actor.unitId : parsed.data.unitId ?? null
  if (unitId) {
    const { data: unit } = await service.from('units').select('id').eq('id', unitId).eq('org_id', orgId).maybeSingle()
    if (!unit) return NextResponse.json({ error: 'Unidade não encontrada nesta organização.' }, { status: 404 })
  }

  const { key, prefix, hash } = generatePartnerKey()
  const { data, error } = await service
    .from('partner_api_keys')
    .insert({
      org_id: orgId,
      unit_id: unitId,
      name: parsed.data.name,
      key_prefix: prefix,
      key_hash: hash,
      scopes: parsed.data.scopes,
      created_by: actor.id,
      expires_at: parsed.data.expiresAt ?? null,
    })
    .select('id, name, key_prefix, scopes, unit_id, expires_at, created_at')
    .single()

  if (error || !data) return NextResponse.json({ error: 'Não foi possível criar a chave.' }, { status: 500 })
  return NextResponse.json({ ok: true, key, apiKey: data }, { status: 201 })
}
