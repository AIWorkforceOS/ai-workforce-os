import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getEvolutionConfig, sendWhatsAppMessage } from '@/lib/evolution'
import type { AgentConfig, Unit } from '@/lib/types'

/**
 * Generic B2C lead intake
 *
 * Use for: landing pages, Google Ads lead forms (via Zapier/Make), any external source.
 *
 * POST /api/intake/lead
 * Headers: { Authorization: Bearer INTAKE_SECRET }
 * Body: { unit_slug, name, phone, email?, source?, notes?, send_whatsapp? }
 */

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization') ?? ''
  const secret = process.env.INTAKE_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
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

  if (send_whatsapp) {
    const { data: agentConfig } = await supabase
      .from('agent_configs')
      .select('*')
      .eq('unit_id', unit.id)
      .eq('agent_type', 'sdr')
      .maybeSingle()

    const config = getEvolutionConfig(unit)

    if (config && agentConfig) {
      const agentName = (agentConfig as AgentConfig).persona_name || 'Assistente'
      const firstName = name ? name.split(' ')[0] : null
      const initialMessage = `Olá${firstName ? `, ${firstName}` : ''}! Sou o ${agentName}. Vi que você tem interesse e quero te ajudar. Pode me contar um pouco mais sobre o que está buscando?`

      try {
        await sendWhatsAppMessage(config, normalizedPhone, initialMessage)

        await supabase.from('conversations').insert({
          lead_id: newLead.id,
          unit_id: unit.id,
          channel: 'whatsapp',
          direction: 'outbound',
          content: initialMessage,
          status: 'sent',
          sent_at: new Date().toISOString(),
        })

        await supabase
          .from('leads')
          .update({ status: 'contacted', last_contacted_at: new Date().toISOString() })
          .eq('id', newLead.id)
      } catch {
        // WhatsApp send failed — lead still created
      }
    }
  }

  return NextResponse.json({ ok: true, lead_id: newLead.id })
}
