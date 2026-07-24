import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getMessagingChannel, getEmailChannel } from '@/lib/channels/messaging-channel'
import { generateFirstContactMessage, sendAcrossChannels } from '@/lib/conversation-engine'
import { ensureLeadEnrichment } from '@/lib/leads/enrichment'
import { syncLeadToSmarterCrm } from '@/lib/sales/smarter-crm'
import { logSystemEvent } from '@/lib/system-events'
import type { AgentConfig, Lead, Unit } from '@/lib/types'

/**
 * Generic B2C lead intake
 *
 * Use for: landing pages, Google Ads lead forms (via Zapier/Make), any external source.
 *
 * POST /api/intake/lead
 * Headers: { Authorization: Bearer <token> }
 *   - token global (env INTAKE_SECRET): aceita qualquer unidade
 *   - token da unidade (units.intake_token, exibido em Configurações):
 *     aceita apenas a própria unidade — é o modo self-service por cliente
 * Body: { unit_slug, name, phone, email?, source?, notes?, send_whatsapp? }
 */

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization') ?? ''
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  const globalSecret = process.env.INTAKE_SECRET

  const supabase = createServiceClient()
  if (!supabase) {
    console.error('[intake] SUPABASE_SERVICE_ROLE_KEY não configurada — intake indisponível.')
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const { unit_slug, name, phone, email, source = 'intake_api', notes, send_whatsapp = true } = body

  if (!unit_slug || !phone) {
    return NextResponse.json({ error: 'unit_slug e phone são obrigatórios.' }, { status: 400 })
  }

  const normalizedPhone = String(phone).replace(/\D/g, '')
  if (normalizedPhone.length < 10) {
    return NextResponse.json({ error: 'Telefone inválido.' }, { status: 400 })
  }

  const { data: unitData } = await supabase
    .from('units')
    .select('*')
    .eq('slug', unit_slug)
    .maybeSingle()

  if (!unitData) {
    return NextResponse.json({ error: `Unidade '${unit_slug}' não encontrada.` }, { status: 404 })
  }

  const unit = unitData as Unit

  const isGlobalToken = Boolean(globalSecret && bearerToken === globalSecret)
  const isUnitToken = Boolean(unit.intake_token && bearerToken === unit.intake_token)
  if (!isGlobalToken && !isUnitToken) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const { data: existing } = await supabase
    .from('leads')
    .select('id, status')
    .eq('unit_id', unit.id)
    .eq('phone', normalizedPhone)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ ok: true, lead_id: existing.id, duplicate: true })
  }

  const { data: newLead, error: insertError } = await supabase
    .from('leads')
    .insert({
      unit_id: unit.id,
      company_name: name ?? 'Lead',
      contact_name: name ?? null,
      phone: normalizedPhone,
      email: email ?? null,
      source,
      notes: notes ?? null,
      status: 'new',
    })
    .select()
    .single()

  if (insertError || !newLead) {
    return NextResponse.json({ error: 'Erro ao criar lead.' }, { status: 500 })
  }

  await syncLeadToSmarterCrm(supabase, unit, newLead as Lead)

  if (send_whatsapp) {
    const { data: agentConfig } = await supabase
      .from('agent_configs')
      .select('*')
      .eq('unit_id', unit.id)
      .eq('agent_type', 'sdr')
      .maybeSingle()

    // E-mail é sempre tentado em paralelo ao WhatsApp/SMS quando o lead
    // tem endereço cadastrado (item 1/2 do pedido) — hasAnyChannel só
    // bloqueia o envio quando NENHUM dos dois está disponível.
    const hasAnyChannel = Boolean(getMessagingChannel(unit) || (email && getEmailChannel(unit)))

    if (!hasAnyChannel || !agentConfig) {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: hasAnyChannel ? 'system' : 'evolution',
        eventType: 'intake_message_skipped',
        message: `Lead recebido via intake na unidade "${unit.name}" mas a mensagem automática não foi enviada: ${hasAnyChannel ? 'AI Sales Representative sem configuração' : 'nenhum canal (WhatsApp/SMS ou e-mail) configurado'}.`,
        orgId: unit.org_id,
        unitId: unit.id,
        leadId: newLead.id,
      })
    }

    if (hasAnyChannel && agentConfig) {
      const config = agentConfig as AgentConfig

      // Pesquisa a empresa (Maps + site) antes do primeiro contato pra
      // personalizar a mensagem em vez do template fixo que existia aqui
      // (lib/leads/enrichment.ts) — mesmo motor de conversa usado pelos
      // outros pontos de entrada de lead (lib/leads/lead-intake.ts).
      const enrichedLead = await ensureLeadEnrichment(supabase, newLead as Lead)

      let message: string
      try {
        message = await generateFirstContactMessage(config, unit, enrichedLead)
      } catch (error) {
        await logSystemEvent(supabase, {
          level: 'error',
          source: 'openai',
          eventType: 'intake_message_failed',
          message: `Falha ao gerar a primeira mensagem para lead do intake: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
          orgId: unit.org_id,
          unitId: unit.id,
          leadId: newLead.id,
        })
        return NextResponse.json({ ok: true, lead_id: newLead.id })
      }

      const { anySent, attempts } = await sendAcrossChannels({
        supabase,
        unit,
        lead: enrichedLead,
        text: message,
        subject: `${config.persona_name} · ${unit.name}`,
        personaName: config.persona_name,
        templateKey: 'primeiro_contato',
      })

      if (anySent) {
        const sentAt = new Date().toISOString()
        await supabase
          .from('leads')
          .update({ status: 'contacted', last_contacted_at: sentAt })
          .eq('id', newLead.id)
        await syncLeadToSmarterCrm(
          supabase,
          unit,
          { ...enrichedLead, status: 'contacted', last_contacted_at: sentAt },
          { statusChanged: true },
        )
      } else {
        // Envio falhou nos canais tentados — lead ainda foi criado, mas a falha precisa ficar visível
        const errors = attempts.map((a) => a.error).filter(Boolean).join(' | ')
        await logSystemEvent(supabase, {
          level: 'error',
          source: 'evolution',
          eventType: 'intake_message_failed',
          message: `Falha ao enviar primeiro contato para lead do intake: ${errors || 'erro desconhecido'}`,
          orgId: unit.org_id,
          unitId: unit.id,
          leadId: newLead.id,
        })
      }
    }
  }

  return NextResponse.json({ ok: true, lead_id: newLead.id })
}
