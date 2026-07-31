import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureWebhookConfigured, getInstanceStatus, legacyWhatsappChannel, resolveWhatsappChannel, syncWhatsappPhoneIfConnected } from '@/lib/evolution'
import type { Unit } from '@/lib/types'

/** `?agentType=` (opcional): ver connect/route.ts — mesma disambiguação por funcionário. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const agentType = new URL(request.url).searchParams.get('agentType')
  const channel = agentType ? await resolveWhatsappChannel(supabase, unitRow, agentType) : legacyWhatsappChannel(supabase, unitRow)

  if (!channel) {
    return NextResponse.json({ status: 'not_configured' })
  }

  try {
    const status = await getInstanceStatus(channel.config)
    if (status === 'open') {
      await syncWhatsappPhoneIfConnected(supabase, unitRow, channel)
      await ensureWebhookConfigured(channel.config)
    }
    return NextResponse.json({ status })
  } catch (error) {
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 502 },
    )
  }
}
