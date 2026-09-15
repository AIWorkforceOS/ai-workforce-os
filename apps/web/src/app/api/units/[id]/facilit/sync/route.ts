import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncFacilitOrdersForUnit, type FacilitCredentialRow } from '@/lib/facilit-sync'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** Botão "Buscar agora" — sync manual sob demanda, além do cron diário. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const [{ data: unit }, { data: credential }] = await Promise.all([
    supabase.from('units').select('*').eq('id', id).single(),
    supabase.from('facilit_credentials').select('*').eq('unit_id', id).eq('is_active', true).maybeSingle(),
  ])

  if (!unit) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }
  if (!credential) {
    return NextResponse.json(
      { error: 'Nenhuma credencial da Facil-IT cadastrada pra essa unidade ainda.' },
      { status: 400 },
    )
  }

  const result = await syncFacilitOrdersForUnit(supabase, unit as Unit, credential as FacilitCredentialRow)
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }
  return NextResponse.json({ ok: true, found: result.found, imported: result.imported, skipped: result.skipped })
}
