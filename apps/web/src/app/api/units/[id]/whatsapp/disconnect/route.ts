import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { disconnectInstance, legacyWhatsappChannel, resolveWhatsappChannel } from '@/lib/evolution'
import type { Unit } from '@/lib/types'

/** `agentType` no corpo (opcional): ver apps/web/src/app/api/units/[id]/whatsapp/connect/route.ts. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const unitRow = unit as Unit

  const body = await request.json().catch(() => null)
  const agentType: string | null = typeof body?.agentType === 'string' ? body.agentType : null
  const channel = agentType ? await resolveWhatsappChannel(supabase, unitRow, agentType) : legacyWhatsappChannel(supabase, unitRow)

  if (!channel) {
    return NextResponse.json({ error: 'Evolution API não configurada para esta unidade.' }, { status: 400 })
  }

  try {
    await disconnectInstance(channel.config)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao desconectar a instância.' },
      { status: 502 },
    )
  }
}
