import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ensureWebhookConfigured, getInstanceStatus, legacyWhatsappChannel, resolveWhatsappChannel, syncWhatsappPhoneIfConnected } from '@/lib/evolution'
import type { Unit } from '@/lib/types'

/**
 * `?agentType=` (opcional): ver apps/web/src/app/api/units/[id]/whatsapp/connect/route.ts.
 * `?token=` (obrigatório, achado P1.2 — mesma justificativa da rota connect/route.ts irmã).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
