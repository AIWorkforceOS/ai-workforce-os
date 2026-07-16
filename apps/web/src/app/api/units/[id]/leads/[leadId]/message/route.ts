import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMessagingChannel, getEmailChannel } from '@/lib/channels/messaging-channel'
import { countSentToday, generateFirstContactMessage, isWithinActiveHours, sendAcrossChannels } from '@/lib/conversation-engine'
import { sendNewLeadEmail } from '@/lib/email'
import type { AgentConfig, Lead, Unit } from '@/lib/types'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; leadId: string }> },
) {
  const { id, leadId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const [{ data: unit }, { data: lead }, { data: agentConfig }] = await Promise.all([
    supabase.from('units').select('*').eq('id', id).single(),
    supabase.from('leads').select('*').eq('id', leadId).eq('unit_id', id).single(),
    supabase.from('agent_configs').select('*').eq('unit_id', id).eq('agent_type', 'sdr').maybeSingle(),
  ])

  if (!unit || !lead) {
    return NextResponse.json({ error: 'Unidade ou lead não encontrado.' }, { status: 404 })
  }

  const unitRow = unit as Unit
  const leadRow = lead as Lead
  const config = agentConfig as AgentConfig | null

  if (!config || !config.is_active) {
    return NextResponse.json({ error: 'Configure e ative o AI Sales Representative desta unidade primeiro.' }, { status: 400 })
  }

  if (!leadRow.phone && !leadRow.email) {
    return NextResponse.json({ error: 'Este lead não possui telefone nem e-mail cadastrado.' }, { status: 400 })
  }

  const hasPhoneChannel = Boolean(leadRow.phone && getMessagingChannel(unitRow))
  const hasEmailChannel = Boolean(leadRow.email && getEmailChannel(unitRow))
  if (!hasPhoneChannel && !hasEmailChannel) {
    return NextResponse.json(
      { error: 'Configure o canal de WhatsApp/SMS ou o e-mail (RESEND_API_KEY/EMAIL_FROM_DOMAIN) desta unidade primeiro.' },
      { status: 400 },
    )
  }

  if (!isWithinActiveHours(config.active_hours)) {
    return NextResponse.json({ error: 'Fora do horário ativo configurado para o agente.' }, { status: 409 })
  }

  const sentToday = await countSentToday(supabase, unitRow.id)
  if (sentToday >= config.daily_limit) {
    return NextResponse.json({ error: 'Limite diário de mensagens do agente foi atingido.' }, { status: 429 })
  }

  let message: string
  try {
    message = await generateFirstContactMessage(config, unitRow, leadRow)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao gerar mensagem.' },
      { status: 502 },
    )
  }

  const { anySent, attempts } = await sendAcrossChannels({
    supabase,
    unit: unitRow,
    lead: leadRow,
    text: message,
    subject: `${config.persona_name} · ${unitRow.name}`,
    personaName: config.persona_name,
    templateKey: 'primeiro_contato',
  })

  if (!anySent) {
    const errors = attempts.map((a) => a.error).filter(Boolean).join(' | ')
    return NextResponse.json(
      { error: errors || 'Erro ao enviar mensagem pelos canais configurados.' },
      { status: 502 },
    )
  }

  const sentAt = new Date().toISOString()

  await supabase
    .from('leads')
    .update({ status: leadRow.status === 'new' ? 'contacted' : leadRow.status, last_contacted_at: sentAt })
    .eq('id', leadRow.id)

  if (unitRow.org_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('owner_email')
      .eq('id', unitRow.org_id)
      .maybeSingle()

    const ownerEmail = (org as { owner_email: string | null } | null)?.owner_email
    if (ownerEmail) {
      await sendNewLeadEmail({
        to: ownerEmail,
        unitName: unitRow.name,
        leadName: leadRow.company_name,
        leadPhone: leadRow.phone,
      })
    }
  }

  return NextResponse.json({ ok: true, message })
}
