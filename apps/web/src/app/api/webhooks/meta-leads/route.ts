import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getEvolutionConfig, sendWhatsAppMessage } from '@/lib/evolution'
import type { AgentConfig, Unit } from '@/lib/types'

/**
 * Meta Lead Ads webhook
 *
 * Setup in Meta Business Manager → Webhooks → Page subscription → leadgen field.
 * Callback URL: https://yourapp.com/api/webhooks/meta-leads?unit=UNIT_SLUG
 * Verify token: value of META_WEBHOOK_VERIFY_TOKEN env var.
 */

// GET — Meta webhook verification challenge
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN
  if (!verifyToken) {
    return NextResponse.json({ error: 'META_WEBHOOK_VERIFY_TOKEN não configurado.' }, { status: 500 })
  }

  if (mode === 'subscribe' && token === verifyToken) {
    return new Response(challenge ?? '', { status: 200 })
  }

  return NextResponse.json({ error: 'Token de verificação inválido.' }, { status: 403 })
}

// POST — receive lead notification and process
export async function POST(request: Request) {
  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const { searchParams } = new URL(request.url)
  const unitSlug = searchParams.get('unit')

  const body = await request.json().catch(() => null)
  if (!body || body.object !== 'page') {
    return NextResponse.json({ ok: true })
  }

  const entries = body.entry ?? []
  for (const entry of entries) {
    const changes = entry.changes ?? []
    for (const change of changes) {
      if (change.field !== 'leadgen') continue

      const leadgenId: string = change.value?.leadgen_id
      if (!leadgenId) continue

      // Fetch full lead data from Meta Graph API
      const accessToken = process.env.META_PAGE_ACCESS_TOKEN
      if (!accessToken) continue

      let metaLead: Record<string, unknown> | null = null
      try {
        const res = await fetch(
          `https://graph.facebook.com/v19.0/${leadgenId}?fields=id,created_time,field_data&access_token=${accessToken}`,
        )
        metaLead = await res.json()
      } catch {
        continue
      }

      if (!metaLead || !Array.isArray(metaLead.field_data)) continue

      // Extract fields from Meta lead form
      const fields: Record<string, string> = {}
      for (const field of metaLead.field_data as { name: string; values: string[] }[]) {
        fields[field.name] = field.values?.[0] ?? ''
      }

      const phone = fields['phone_number'] || fields['phone'] || fields['whatsapp'] || null
      const name = fields['full_name'] || fields['first_name'] || fields['nome'] || null
      const email = fields['email'] || null

      if (!phone) continue

      // Find the target unit
      let unitQuery = supabase.from('units').select('*')
      if (unitSlug) {
        unitQuery = unitQuery.eq('slug', unitSlug)
      } else {
        // Fall back to first active unit (single-tenant mode)
        unitQuery = unitQuery.eq('is_active', true).limit(1)
      }
      const { data: unitData } = await unitQuery.maybeSingle()
      if (!unitData) continue

      const unit = unitData as Unit

      // Normalise phone
      const normalizedPhone = phone.replace(/\D/g, '')

      // Create lead
      const { data: insertedLead } = await supabase
        .from('leads')
        .insert({
          unit_id: unit.id,
          company_name: name ?? 'Lead Meta Ads',
          contact_name: name,
          phone: normalizedPhone,
          email,
          source: 'meta_lead_ad',
          status: 'new',
        })
        .select()
        .single()

      if (!insertedLead) continue

      // Get agent config to build first message
      const { data: agentConfig } = await supabase
        .from('agent_configs')
        .select('*')
        .eq('unit_id', unit.id)
        .eq('agent_type', 'sdr')
        .maybeSingle()

      const config = getEvolutionConfig(unit)
      if (!config || !agentConfig) continue

      // Send initial WhatsApp message
      const agentName = (agentConfig as AgentConfig).persona_name || 'Assistente'
      const initialMessage =
        `Olá${name ? `, ${name.split(' ')[0]}` : ''}! Sou o ${agentName}. Vi que você demonstrou interesse e gostaria de te ajudar. Pode falar?`

      try {
        await sendWhatsAppMessage(config, normalizedPhone, initialMessage)

        await supabase.from('conversations').insert({
          lead_id: insertedLead.id,
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
          .eq('id', insertedLead.id)
      } catch {
        // WhatsApp not connected — lead is still created
      }
    }
  }

  return NextResponse.json({ ok: true })
}
