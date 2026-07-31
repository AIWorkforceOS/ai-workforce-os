import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { connectInstance, ensureDedicatedWhatsappChannel, getEvolutionConfig } from '@/lib/evolution'
import type { Unit } from '@/lib/types'

/**
 * `agentType` no corpo (opcional): quando informado, conecta uma instância
 * DEDICADA a esse funcionário (migration 051, unit_whatsapp_channels) —
 * usado pela tela de conexão quando a unidade tem mais de um funcionário
 * elegível a WhatsApp (ex.: Sales Rep e Recepcionista, cada um com seu
 * próprio número). Omitido, mantém o comportamento histórico (número
 * único compartilhado da unidade, units.evolution_instance_name).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
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

  const dedicated = agentType ? await ensureDedicatedWhatsappChannel(supabase, unitRow, agentType) : null
  const config = agentType ? dedicated?.config ?? null : getEvolutionConfig(unitRow)

  if (!config) {
    // Sem Evolution central (env) nem dedicada (unidade): situação de
    // infra que o cliente não resolve sozinho — mensagem em linguagem leiga.
    return NextResponse.json(
      { error: 'O serviço de WhatsApp ainda não está habilitado pra sua conta. Fale com a gente em suporte@alizo.com.br que resolvemos rapidinho.' },
      { status: 400 },
    )
  }

  // Comportamento histórico (sem agentType): salva o nome de instância
  // auto-gerado de volta pra unidade, pro webhook conseguir identificá-la.
  // Com agentType, ensureDedicatedWhatsappChannel já garante a linha em
  // unit_whatsapp_channels.
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
