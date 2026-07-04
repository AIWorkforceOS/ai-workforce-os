import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { connectInstance, getEvolutionConfig } from '@/lib/evolution'
import type { Unit } from '@/lib/types'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json(
      { error: 'Configure a URL, a API key e o nome da instância Evolution API desta unidade primeiro.' },
      { status: 400 },
    )
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
