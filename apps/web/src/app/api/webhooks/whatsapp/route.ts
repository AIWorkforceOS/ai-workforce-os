import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { processInboundMessage } from '@/lib/conversation-engine'
import type { Lead, Unit } from '@/lib/types'

function normalizePhone(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '')
}

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
    return NextResponse.json({ error: 'Unidade não encontrada para esta instância.' }, { status: 404 })
  }

  const unitRow = unit as Unit
  const remoteJid: string = key.remoteJid ?? ''
  const incomingPhone = normalizePhone(remoteJid.split('@')[0])

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('unit_id', unitRow.id)
    .not('phone', 'is', null)

  const lead = (leads as Lead[] | null)?.find((candidate) => {
    const candidatePhone = normalizePhone(candidate.phone)
    return (
      candidatePhone.length > 0 &&
      (candidatePhone.endsWith(incomingPhone.slice(-8)) ||
        incomingPhone.endsWith(candidatePhone.slice(-8)))
    )
  })

  if (!lead) {
    return NextResponse.json({ ok: true, skipped: 'lead_not_found' })
  }

  const sentAt = data.messageTimestamp
    ? new Date(Number(data.messageTimestamp) * 1000).toISOString()
    : new Date().toISOString()

  await supabase.from('conversations').insert({
    lead_id: lead.id,
    unit_id: unitRow.id,
    channel: 'whatsapp',
    direction: 'inbound',
    content: text,
    external_message_id: key.id ?? null,
    status: 'delivered',
    sent_at: sentAt,
  })

  const updatedLead: Lead = {
    ...lead,
    status: lead.status === 'new' ? 'replied' : lead.status,
    last_contacted_at: sentAt,
  }

  await supabase
    .from('leads')
    .update({ status: updatedLead.status, last_contacted_at: sentAt })
    .eq('id', lead.id)

  await processInboundMessage({ supabase, unit: unitRow, lead: updatedLead, incomingText: text })

  return NextResponse.json({ ok: true })
}
