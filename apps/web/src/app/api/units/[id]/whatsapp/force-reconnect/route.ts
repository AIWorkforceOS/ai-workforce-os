import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureDedicatedWhatsappChannel, forceReconnectInstance, getEvolutionConfig } from '@/lib/evolution'
import type { Unit } from '@/lib/types'

/**
 * Apaga e recria a instância do zero na Evolution API — recuperação
 * pra quando o botão "Conectar" normal (connect/route.ts) continua
 * mostrando QR mas o pareamento nunca conclui, mesmo com o número
 * funcionando normalmente no WhatsApp (achado do Vinicius, 2026-09-17:
 * "Ana" Recepcionista da Smarter Matriz). Ação destrutiva e explícita
 * do usuário — nunca chamada automaticamente (ver comentário de
 * forceReconnectInstance em lib/evolution.ts pro porquê disso não é
 * o comportamento padrão de "Conectar").
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
    return NextResponse.json(
      { error: 'O serviço de WhatsApp ainda não está habilitado pra sua conta. Fale com a gente em suporte@alizo.com.br que resolvemos rapidinho.' },
      { status: 400 },
    )
  }

  try {
    const data = await forceReconnectInstance(config, { supabase, orgId: unitRow.org_id, unitId: unitRow.id })
    const qrCode = data?.base64 ?? data?.qrcode?.base64 ?? null
    const pairingCode = data?.pairingCode ?? data?.qrcode?.pairingCode ?? null
    return NextResponse.json({ qrCode, pairingCode })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao recriar a instância na Evolution API.' },
      { status: 502 },
    )
  }
}
