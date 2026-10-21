import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireClientProfileAdmin } from '@/lib/client-profiles/auth'
import { updateClientProfileSchema } from '@/lib/client-profiles/schema'
import { CLIENT_PROFILE_COLUMNS } from '@/lib/client-profiles/profile'

export const dynamic = 'force-dynamic'

/** Edita os dados do cliente. O nome não muda (é o vínculo com as ordens). A RLS garante que só o administrador da MESMA empresa altera. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClientProfileAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const parsed = updateClientProfileSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  const supabase = await createClient()
  const { data, error } = await supabase.from('client_company_profiles').update(parsed.data).eq('id', id).select(CLIENT_PROFILE_COLUMNS).maybeSingle()
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 })
  return NextResponse.json({ profile: data })
}
