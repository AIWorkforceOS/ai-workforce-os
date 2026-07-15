import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createAdLead } from '@/lib/leads/ad-lead-intake'
import type { Unit } from '@/lib/types'

/**
 * Google Ads Lead Form Extension webhook.
 *
 * Setup: Google Ads → extensão de formulário de lead → notificações →
 * webhook URL: https://yourapp.com/api/webhooks/google-leads?unit=UNIT_SLUG
 * webhook key: valor de GOOGLE_ADS_LEAD_WEBHOOK_KEY (o Google não assina
 * o payload — reenvia de volta a mesma chave compartilhada configurada
 * nos dois lados, em "google_key").
 */

type GoogleLeadColumn = { column_id?: string; string_value?: string }

export async function POST(request: Request) {
  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ ok: true })
  }

  // Falha graciosa (regra do projeto): sem a chave configurada, o lead é
  // ignorado com log, em vez de aceitar qualquer payload sem verificação.
  const webhookKey = process.env.GOOGLE_ADS_LEAD_WEBHOOK_KEY
  if (!webhookKey) {
    console.error('[webhook_google_leads] GOOGLE_ADS_LEAD_WEBHOOK_KEY não configurada — lead ignorado.')
    return NextResponse.json({ ok: true })
  }
  if (body.google_key !== webhookKey) {
    return NextResponse.json({ error: 'Chave de verificação inválida.' }, { status: 403 })
  }
  if (body.is_test) {
    return NextResponse.json({ ok: true })
  }

  const { searchParams } = new URL(request.url)
  const unitSlug = searchParams.get('unit')

  let unitQuery = supabase.from('units').select('*')
  unitQuery = unitSlug ? unitQuery.eq('slug', unitSlug) : unitQuery.eq('is_active', true).limit(1)
  const { data: unitData } = await unitQuery.maybeSingle()
  if (!unitData) {
    return NextResponse.json({ ok: true })
  }

  const columns: GoogleLeadColumn[] = Array.isArray(body.user_column_data) ? body.user_column_data : []
  const findColumn = (columnId: string): string | null => {
    const value = columns.find((c) => c.column_id === columnId)?.string_value
    return typeof value === 'string' && value.trim() ? value : null
  }

  await createAdLead(supabase, {
    unit: unitData as Unit,
    lead: {
      name: findColumn('FULL_NAME') ?? findColumn('FIRST_NAME'),
      phone: findColumn('PHONE_NUMBER'),
      email: findColumn('EMAIL'),
      source: 'google_lead_ad',
    },
  })

  return NextResponse.json({ ok: true })
}
