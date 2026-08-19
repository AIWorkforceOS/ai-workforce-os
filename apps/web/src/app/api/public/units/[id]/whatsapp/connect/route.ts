import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { connectInstance, ensureDedicatedWhatsappChannel, getEvolutionConfig } from '@/lib/evolution'
import type { Unit } from '@/lib/types'

/**
 * `agentType` no corpo (opcional): ver apps/web/src/app/api/units/[id]/whatsapp/connect/route.ts.
 *
 * `?token=` (obrigatório, achado P1.2 da auditoria de 19/08/2026): sem
 * autenticação de sessão (é a rota por trás do link público
 * /connect-whatsapp/[id], escaneado no celular do chip, sem login) —
 * antes bastava saber o unit_id para gerar QR Code e re-parear o
 * WhatsApp de QUALQUER unidade. Agora exige o token de baixo risco
 * escopado à unidade (units.whatsapp_connect_token, migration 068),
 * validado direto no banco (não é um "segredo" comparado em memória).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const token = new URL(request.url).searchParams.get('token')
  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 503 })
  }

  if (!token) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const { data: unit } = await supabase
    .from('units')
    .select('*')
    .eq('id', id)
    .eq('whatsapp_connect_token', token)
    .maybeSingle()
  if (!unit) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
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
