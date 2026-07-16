import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { normalizePhone, routeInboundMessage } from '@/lib/inbound-router'
import type { Unit } from '@/lib/types'

export const maxDuration = 60

function extractMessageText(message: Record<string, unknown> | undefined): string | null {
  if (!message) return null
  if (typeof message.conversation === 'string') return message.conversation
  const extended = message.extendedTextMessage as { text?: string } | undefined
  if (extended?.text) return extended.text
  const image = message.imageMessage as { caption?: string } | undefined
  if (image?.caption) return image.caption
  return null
}

export async function POST(request: Request) {
  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const instanceName: string | undefined = body.instance
  const data = body.data ?? {}
  const key = data.key ?? {}

  // Ignora mensagens enviadas pela própria unidade (eco do envio outbound)
  if (!instanceName || key.fromMe) {
    return NextResponse.json({ ok: true })
  }

  const text = extractMessageText(data.message)
  if (!text) {
    return NextResponse.json({ ok: true })
  }

  const { data: unit } = await supabase
    .from('units')
    .select('*')
    .eq('evolution_instance_name', instanceName)
    .maybeSingle()

  if (!unit) {
    console.error(
      `[webhook_whatsapp] mensagem recebida para instância "${instanceName}" mas nenhuma unidade corresponde a ela — verifique units.evolution_instance_name.`,
    )
    return NextResponse.json({ error: 'Unidade não encontrada para esta instância.' }, { status: 404 })
  }

  const unitRow = unit as Unit
  const remoteJid: string = key.remoteJid ?? ''
  const incomingPhone = normalizePhone(remoteJid.split('@')[0])

  const sentAt = data.messageTimestamp
    ? new Date(Number(data.messageTimestamp) * 1000).toISOString()
    : new Date().toISOString()

  const result = await routeInboundMessage({
    supabase,
    unit: unitRow,
    channel: 'whatsapp',
    incomingPhone,
    text,
    externalMessageId: key.id ?? null,
    sentAt,
  })

  return NextResponse.json(result)
}
