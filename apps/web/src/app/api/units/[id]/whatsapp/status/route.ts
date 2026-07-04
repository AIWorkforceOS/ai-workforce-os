import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getEvolutionConfig, getInstanceStatus } from '@/lib/evolution'
import type { Unit } from '@/lib/types'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const { data: unit } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unit) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }

  const config = getEvolutionConfig(unit as Unit)
  if (!config) {
    return NextResponse.json({ status: 'not_configured' })
  }

  try {
    const status = await getInstanceStatus(config)
    return NextResponse.json({ status })
  } catch (error) {
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 502 },
    )
  }
}
