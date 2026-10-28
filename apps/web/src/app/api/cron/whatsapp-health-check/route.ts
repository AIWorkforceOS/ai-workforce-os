import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import {
  ensureWebhookConfigured,
  getInstanceStatus,
  legacyWhatsappChannel,
  syncWhatsappPhoneIfConnected,
} from '@/lib/evolution'
import { sendWhatsappDisconnectedEmail } from '@/lib/email'
import { logSystemEvent } from '@/lib/system-events'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Verificação de saúde do WhatsApp de cada unidade (pedido do
 * Vinicius, 2026-09-08): "temos que ter algum tipo de notificação quando o
 * whats desconectar pq o cliente não vai saber o que aconteceu e como
 * resolver". Achado real que motivou isso: o WhatsApp da unidade "Smarter
 * Matriz" caiu e ficou 4 dias sem receber NENHUMA mensagem, sem ninguém
 * perceber — a Recepcionista não estava "ignorando" ninguém, as mensagens
 * simplesmente não chegavam até ela (sessão do celular vinculado caiu).
 *
 * Não dá pra avisar por WhatsApp (é exatamente o canal que está fora do
 * ar) — sempre por e-mail, pro dono da unidade (organizations.owner_email,
 * mesmo destino já usado pelos alertas do TI interno).
 *
 * Na Vercel Hobby roda 1x/dia (limite atual do plano). A mesma rota pode
 * ser chamada com mais frequência por um monitor externo confiável usando
 * CRON_SECRET, sem criar outro mecanismo de recuperação concorrente.
 * Cooldown de 20h por (unidade, canal) via system_events, pra não mandar
 * o mesmo aviso 2x no mesmo dia se o cron for re-executado — mas manda de
 * novo no dia seguinte enquanto continuar desconectado, até ser resolvido.
 *
 * Só verifica unidades que JÁ tiveram um número conectado alguma vez
 * (units.whatsapp_phone preenchido, ou uma linha em unit_whatsapp_channels)
 * — unidade que nunca ligou o WhatsApp não é "desconexão", é "nunca
 * conectou", um estado normal que não deve virar alerta.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') ?? ''

  if (!cronSecret) {
    console.error('[cron/whatsapp-health-check] CRON_SECRET não configurado — cron desabilitado.')
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    console.error('[cron/whatsapp-health-check] SUPABASE_SERVICE_ROLE_KEY não configurada.')
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const { data: unitsData } = await supabase.from('units').select('*').eq('is_active', true)
  const units = (unitsData ?? []) as Unit[]

  let checked = 0
  let disconnected = 0
  let alertsSent = 0
  let errors = 0
  let webhooksVerified = 0
  let repairFailures = 0

  for (const unit of units) {
    // Desde a migration 113 existe um único número compartilhado por unidade.
    // Linhas dedicadas antigas não podem voltar a ser tratadas como conexões
    // independentes, pois isso causaria alertas duplicados e instâncias órfãs.
    if (!unit.whatsapp_phone) continue
    const channel = legacyWhatsappChannel(supabase, unit)
    if (!channel) continue

    checked += 1
    try {
      const status = await getInstanceStatus(channel.config)
      if (status === 'open') {
        await syncWhatsappPhoneIfConnected(supabase, unit, channel)
        const webhookOk = await ensureWebhookConfigured(channel.config, {
          supabase,
          orgId: unit.org_id,
          unitId: unit.id,
        })
        if (webhookOk) webhooksVerified += 1
        else repairFailures += 1
        continue
      }

      disconnected += 1
      const sent = await alertIfNeeded(supabase, unit, null)
      if (sent) alertsSent += 1
    } catch (error) {
      errors += 1
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'cron',
        eventType: 'whatsapp_health_check_status_failed',
        message: `Falha ao checar status do WhatsApp da unidade "${unit.name}": ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        orgId: unit.org_id,
        unitId: unit.id,
      })
    }
  }

  await logSystemEvent(supabase, {
    level: disconnected > 0 || errors > 0 || repairFailures > 0 ? 'warning' : 'info',
    source: 'cron',
    eventType: 'whatsapp_health_check_run',
    message: `Verificação de saúde do WhatsApp executada: ${checked} canal(is) checado(s), ${webhooksVerified} webhook(s) confirmado(s), ${repairFailures} reparo(s) com falha, ${disconnected} desconectado(s), ${alertsSent} aviso(s) enviado(s), ${errors} erro(s).`,
  })

  return NextResponse.json({
    ok: errors === 0 && repairFailures === 0,
    checked,
    webhooksVerified,
    repairFailures,
    disconnected,
    alertsSent,
    errors,
  })
}

const AGENT_LABEL: Record<string, string> = {
  receptionist: 'Recepcionista',
  sdr: 'Sales Rep',
  recruiter: 'Recrutador',
}

const ALERT_COOLDOWN_HOURS = 20

/**
 * Manda o aviso de desconexão só se não tiver mandado um pra esse
 * (unidade, canal) nas últimas ALERT_COOLDOWN_HOURS — evita duplicar no
 * mesmo dia. Filtra metadata.agentType em memória (mesmo padrão de
 * hasRecentEventForContact em lib/system-events.ts) em vez do operador
 * JSON do Postgres — volume pequeno, não vale a complexidade.
 */
async function alertIfNeeded(supabase: SupabaseClient, unit: Unit, agentType: string | null): Promise<boolean> {
  const since = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString()
  const { data: recentAlerts } = await supabase
    .from('system_events')
    .select('metadata')
    .eq('unit_id', unit.id)
    .eq('event_type', 'whatsapp_disconnected_alert_sent')
    .gte('created_at', since)
    .limit(20)
  const alreadyAlerted = ((recentAlerts as { metadata: Record<string, unknown> | null }[] | null) ?? []).some(
    (row) => (row.metadata?.agentType ?? null) === agentType,
  )
  if (alreadyAlerted) return false

  if (!unit.org_id) return false
  const { data: org } = await supabase.from('organizations').select('owner_email').eq('id', unit.org_id).maybeSingle()
  const ownerEmail = (org as { owner_email: string | null } | null)?.owner_email
  if (!ownerEmail) {
    await logSystemEvent(supabase, {
      level: 'warning',
      source: 'cron',
      eventType: 'whatsapp_health_check_no_owner_email',
      message: `WhatsApp desconectado na unidade "${unit.name}", mas a organização não tem owner_email cadastrado — aviso não enviado.`,
      orgId: unit.org_id,
      unitId: unit.id,
    })
    return false
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.alizoai.com').replace(/\/+$/, '')
  const result = await sendWhatsappDisconnectedEmail({
    to: ownerEmail,
    unitName: unit.name,
    agentLabel: agentType ? (AGENT_LABEL[agentType] ?? agentType) : null,
    reconnectUrl: `${appUrl}/dashboard/units/${unit.id}`,
  })

  await logSystemEvent(supabase, {
    level: result.ok ? 'warning' : 'error',
    source: 'cron',
    eventType: result.ok ? 'whatsapp_disconnected_alert_sent' : 'whatsapp_disconnected_alert_failed',
    message: result.ok
      ? `Aviso de WhatsApp desconectado enviado para "${ownerEmail}" (unidade "${unit.name}"${agentType ? `, canal ${agentType}` : ''}).`
      : `Falha ao enviar aviso de WhatsApp desconectado (unidade "${unit.name}"): ${result.error ?? 'erro desconhecido'}.`,
    orgId: unit.org_id,
    unitId: unit.id,
    metadata: { agentType },
  })

  return result.ok
}
