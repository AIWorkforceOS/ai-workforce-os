import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getMessagingChannel, getEmailChannel } from '@/lib/channels/messaging-channel'
import { getOpenAIApiKey } from '@/lib/openai'
import {
  countSentToday,
  generateFollowUpMessage,
  isWithinActiveHours,
  sendAcrossChannels,
} from '@/lib/conversation-engine'
import { logSystemEvent } from '@/lib/system-events'
import type { AgentConfig, Conversation, Lead, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FOLLOW_UP_TEMPLATE_KEY = 'follow_up_auto'

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * Follow-up automático de leads parados.
 *
 * Executado diariamente pelo Vercel Cron (ver vercel.json). Para cada
 * unidade com agente SDR ativo, encontra leads em 'contacted'/'replied'
 * sem contato há FOLLOW_UP_AFTER_DAYS dias e dispara uma mensagem de
 * follow-up gerada pelo mesmo motor do agente, respeitando horário
 * ativo, limite diário e um teto de FOLLOW_UP_MAX follow-ups por lead.
 *
 * Env vars:
 *   CRON_SECRET            — obrigatório (Vercel envia como Bearer token)
 *   FOLLOW_UP_AFTER_DAYS   — dias sem resposta antes do follow-up (padrão 3)
 *   FOLLOW_UP_MAX          — máximo de follow-ups automáticos por lead (padrão 2)
 *   FOLLOW_UP_MAX_PER_UNIT — teto de envios por unidade por execução (padrão 10)
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') ?? ''

  if (!cronSecret) {
    console.error('[cron/follow-up] CRON_SECRET não configurado — cron desabilitado.')
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    console.error('[cron/follow-up] SUPABASE_SERVICE_ROLE_KEY não configurada.')
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  if (!getOpenAIApiKey()) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'cron',
      eventType: 'follow_up_missing_openai',
      message: 'Cron de follow-up abortado: OPENAI_API_KEY não está configurada.',
    })
    return NextResponse.json({ error: 'OPENAI_API_KEY não configurada.' }, { status: 500 })
  }

  const afterDays = intFromEnv('FOLLOW_UP_AFTER_DAYS', 3)
  const maxFollowUps = intFromEnv('FOLLOW_UP_MAX', 2)
  const maxPerUnit = intFromEnv('FOLLOW_UP_MAX_PER_UNIT', 10)
  const cutoff = new Date(Date.now() - afterDays * 24 * 60 * 60 * 1000).toISOString()

  const { data: configs } = await supabase
    .from('agent_configs')
    .select('*, units(*)')
    .eq('agent_type', 'sdr')
    .eq('is_active', true)

  type ConfigWithUnit = AgentConfig & { units: Unit | null }
  const configRows = ((configs ?? []) as ConfigWithUnit[]).filter(
    (row) => row.units && row.units.is_active,
  )

  let totalSent = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (const config of configRows) {
    const unit = config.units as Unit

    if (!isWithinActiveHours(config.active_hours)) {
      totalSkipped += 1
      continue
    }

    // E-mail é sempre adicional (item 2 do pedido): só pula a unidade
    // inteira quando NENHUM dos dois canais (telefone da unidade,
    // e-mail da plataforma) está disponível — cada lead ainda escolhe
    // entre os dois de acordo com o que tem cadastrado.
    const hasPhoneChannel = Boolean(getMessagingChannel(unit))
    const hasEmailChannel = Boolean(getEmailChannel(unit))
    if (!hasPhoneChannel && !hasEmailChannel) {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'system',
        eventType: 'follow_up_unit_skipped',
        message: `Follow-up pulado na unidade "${unit.name}": nenhum canal (WhatsApp/SMS ou e-mail) configurado.`,
        orgId: unit.org_id,
        unitId: unit.id,
      })
      totalSkipped += 1
      continue
    }

    let sentToday = await countSentToday(supabase, unit.id)

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('unit_id', unit.id)
      .in('status', ['contacted', 'replied'])
      .or('phone.not.is.null,email.not.is.null')
      .lte('last_contacted_at', cutoff)
      .order('last_contacted_at', { ascending: true })
      .limit(maxPerUnit)

    for (const lead of (staleLeads as Lead[] | null) ?? []) {
      if (sentToday >= config.daily_limit) break

      const { data: history } = await supabase
        .from('conversations')
        .select('*')
        .eq('lead_id', lead.id)
        .order('sent_at', { ascending: true })
        .limit(20)

      const historyRows = (history as Conversation[] | null) ?? []
      const followUpsSent = historyRows.filter(
        (row) => row.direction === 'outbound' && row.template_key === FOLLOW_UP_TEMPLATE_KEY,
      ).length

      if (followUpsSent >= maxFollowUps) continue

      try {
        const message = await generateFollowUpMessage(config, unit, lead, historyRows)
        if (!message) continue

        const { anySent } = await sendAcrossChannels({
          supabase,
          unit,
          lead,
          text: message,
          subject: `${config.persona_name} · ${unit.name}`,
          personaName: config.persona_name,
          templateKey: FOLLOW_UP_TEMPLATE_KEY,
        })
        if (!anySent) continue

        const sentAt = new Date().toISOString()
        await supabase.from('leads').update({ last_contacted_at: sentAt }).eq('id', lead.id)

        sentToday += 1
        totalSent += 1
      } catch (error) {
        totalErrors += 1
        await logSystemEvent(supabase, {
          level: 'error',
          source: 'cron',
          eventType: 'follow_up_send_failed',
          message: `Falha no follow-up automático do lead "${lead.company_name}": ${error instanceof Error ? error.message : 'erro desconhecido'}`,
          orgId: unit.org_id,
          unitId: unit.id,
          leadId: lead.id,
        })
      }
    }
  }

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'cron',
    eventType: 'follow_up_run',
    message: `Cron de follow-up executado: ${totalSent} enviados, ${totalSkipped} unidades puladas, ${totalErrors} erros.`,
    metadata: { afterDays, maxFollowUps, maxPerUnit },
  })

  return NextResponse.json({ ok: true, sent: totalSent, skippedUnits: totalSkipped, errors: totalErrors })
}
