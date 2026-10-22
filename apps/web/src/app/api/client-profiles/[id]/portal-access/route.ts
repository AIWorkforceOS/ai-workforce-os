import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireClientProfileAdmin } from '@/lib/client-profiles/auth'
import { sameClientName } from '@/lib/client-profiles/profile'
import { provisionLogin, resetLoginPassword } from '@/lib/auth/provision-login'

export const dynamic = 'force-dynamic'

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://www.alizoai.com').replace(/\/+$/, '')
}

/** O cliente é da empresa de quem pede? (a RLS devolve a linha só para o administrador da própria empresa) */
async function loadOwnProfile(id: string) {
  const supabase = await createClient()
  const { data } = await supabase.from('client_company_profiles').select('id, org_id, name').eq('id', id).maybeSingle()
  return data as { id: string; org_id: string; name: string } | null
}

type LoginRow = { id: string; email: string; name: string | null; client_company: string | null; is_active: boolean }

async function loginsOf(service: NonNullable<ReturnType<typeof createServiceClient>>, clientName: string): Promise<LoginRow[]> {
  const { data } = await service.from('users').select('id, email, name, client_company, is_active').eq('role', 'client').not('client_company', 'is', null).limit(1000)
  return ((data ?? []) as LoginRow[]).filter((u) => sameClientName(u.client_company, clientName))
}

/** Lista os logins do portal deste cliente. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClientProfileAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const profile = await loadOwnProfile(id)
  if (!profile) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 })
  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Servidor sem acesso de gravação configurado.' }, { status: 500 })
  const logins = await loginsOf(service, profile.name)
  return NextResponse.json({ logins: logins.map((l) => ({ id: l.id, email: l.email, name: l.name, isActive: l.is_active })) })
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  name: z.string().trim().max(120).optional(),
  login: z.discriminatedUnion('kind', [z.object({ kind: z.literal('password'), password: z.string() }), z.object({ kind: z.literal('invite') })]),
})

/**
 * Cria o login do portal para este cliente (e-mail + senha definida agora, ou link para a pessoa criar a própria senha). O login enxerga SOMENTE as
 * ordens deste cliente (users.client_company; org nula de propósito — ver migration 061). Nunca reaproveita uma conta que já existe.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClientProfileAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 })
  const profile = await loadOwnProfile(id)
  if (!profile) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 })
  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Servidor sem acesso de gravação configurado.' }, { status: 500 })

  const { email, name, login } = parsed.data
  const created = await provisionLogin(service, {
    email,
    mode: login.kind === 'password' ? { kind: 'password', password: login.password } : { kind: 'invite', redirectTo: `${siteUrl()}/auth/set-password` },
    row: { name: name || profile.name, role: 'client', org_id: null, unit_id: null, client_company: profile.name },
  })
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: created.status })
  return NextResponse.json({ ok: true, email, setupLink: created.setupLink }, { status: 201 })
}

const manageSchema = z.object({ userId: z.string().uuid(), active: z.boolean().optional(), newPassword: z.string().optional() })

/** Desativa/reativa um login do portal ou redefine a senha dele. Só logins DESTE cliente. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClientProfileAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const parsed = manageSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || (parsed.data.active === undefined && parsed.data.newPassword === undefined)) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  const profile = await loadOwnProfile(id)
  if (!profile) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 })
  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Servidor sem acesso de gravação configurado.' }, { status: 500 })

  const target = (await loginsOf(service, profile.name)).find((l) => l.id === parsed.data.userId)
  if (!target) return NextResponse.json({ error: 'Login não encontrado neste cliente.' }, { status: 404 })

  if (parsed.data.newPassword !== undefined) {
    const reset = await resetLoginPassword(service, target.email, parsed.data.newPassword)
    if (!reset.ok) return NextResponse.json({ error: reset.error }, { status: reset.status })
  }
  if (parsed.data.active !== undefined) {
    const { error } = await service.from('users').update({ is_active: parsed.data.active }).eq('id', target.id)
    if (error) return NextResponse.json({ error: 'Não foi possível atualizar o acesso.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
