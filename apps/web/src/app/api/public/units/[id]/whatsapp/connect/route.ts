import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { connectInstance, ensureDedicatedWhatsappChannel, getEvolutionConfig } from '@/lib/evolution'
import type { Unit } from '@/lib/types'

/** `agentType` no corpo (opcional): ver apps/web/src/app/api/units/[id]/whatsapp/connect/route.ts. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 503 })
  }

  const { data: unit } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unit) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }
  const unitRow = unit as Unit

  const body = await request.json().catch(() => null)
  const agentType: string | null = typeof body?.agentType === 'string' ? body.agentType : null

  const dedicated = agentType ? await ensureDedicatedWhatsappChannel(supabase, unitRow, agentType) : null
  const config = agentType ? dedicated?.config ?? null : getEvolutionConfig(unitRow)

  if (!config) {
    return NextResponse.json(
      { error: 'Esta unidade ainda não tem a Evolution API configurada.' },
      { status: 400 },
    )
  }

  if (!agentType && !unitRow.evolution_instance_name) {
    await supabase
      .from('units')
      .update({ evolution_instance_name: config.instanceName })
      .eq('id', id)
  }

  try {
    const data = await connectInstance(config)
    const qrCode = data?.base64 ?? data?.qrcode?.base64 ?? null
    const pairingCode = data?.pairingCode ?? data?.qrcode?.pairingCode ?? null
    return NextResponse.json({ qrCode, pairingCode })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao conectar com a Evolution API.' },
      { status: 502 },
    )
  }
}
