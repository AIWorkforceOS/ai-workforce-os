import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireClientProfileAdmin } from '@/lib/client-profiles/auth'
import { createClientProfileSchema } from '@/lib/client-profiles/schema'
import { CLIENT_PROFILE_COLUMNS, normalizeClientName } from '@/lib/client-profiles/profile'

export const dynamic = 'force-dynamic'

/** Lista os clientes cadastrados da empresa (a RLS limita à empresa do usuário). */
export async function GET() {
  const auth = await requireClientProfileAdmin()
  if (!auth.ok) return auth.response
  const supabase = await createClient()
  const { data, error } = await supabase.from('client_company_profiles').select(CLIENT_PROFILE_COLUMNS).order('name')
  if (error) return NextResponse.json({ error: 'Não foi possível carregar os clientes.' }, { status: 500 })
  return NextResponse.json({ profiles: data ?? [] })
}

/**
 * Cadastra um cliente (Facility) com os dados que sairão nas ordens dele. Também garante o cadastro de "cliente" em cada unidade da empresa
 * (customers.client_company), que é o vínculo usado pelas ordens e pelo Portal do Cliente.
 */
export async function POST(request: Request) {
  const auth = await requireClientProfileAdmin()
  if (!auth.ok) return auth.response
  const { appUser } = auth
  const parsed = createClientProfileSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 })
  const { orgId: orgParam, name: rawName, ...fields } = parsed.data
  // Só o super admin escolhe a empresa; para os demais vale a empresa do próprio usuário.
  const orgId = appUser.isSuperAdmin ? orgParam ?? appUser.orgId : appUser.orgId
  if (!orgId) return NextResponse.json({ error: 'Informe a empresa.' }, { status: 400 })
  const name = normalizeClientName(rawName)

  const supabase = await createClient()
  const { data: created, error } = await supabase
    .from('client_company_profiles')
    .insert({ org_id: orgId, name, created_by: appUser.id, ...fields })
    .select(CLIENT_PROFILE_COLUMNS)
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Já existe um cliente com este nome.' }, { status: 409 })
    if (error.code === '42501') return NextResponse.json({ error: 'Sem permissão para cadastrar clientes nesta empresa.' }, { status: 403 })
    return NextResponse.json({ error: 'Não foi possível cadastrar o cliente.' }, { status: 500 })
  }

  // Vínculo com as ordens: um "cliente" por unidade da empresa. Falha aqui não desfaz o cadastro (aparece como aviso).
  let linkWarning: string | null = null
  try {
    const { data: units } = await supabase.from('units').select('id').eq('org_id', orgId).eq('is_active', true)
    for (const unit of (units ?? []) as { id: string }[]) {
      const { data: existing } = await supabase.from('customers').select('id').eq('unit_id', unit.id).ilike('client_company', name).limit(1).maybeSingle()
      if (existing) continue
      const { error: customerError } = await supabase.from('customers').insert({ org_id: orgId, unit_id: unit.id, name, client_company: name, source: 'client_profile' })
      if (customerError) linkWarning = 'O cliente foi cadastrado, mas não foi possível criar o vínculo com todas as unidades.'
    }
  } catch {
    linkWarning = 'O cliente foi cadastrado, mas não foi possível criar o vínculo com as unidades.'
  }
  return NextResponse.json({ profile: created, warning: linkWarning }, { status: 201 })
}
