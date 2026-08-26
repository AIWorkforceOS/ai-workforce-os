import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveWhatsappChannel, sendWhatsAppMessage, type EvolutionUnitConfig } from '@/lib/evolution'
import { localDateString, zonedTimeToUtc } from '@/lib/slot-engine'
import { logSystemEvent, hasRecentEventForContact } from '@/lib/system-events'
import { getOpenAIApiKey } from '@/lib/openai'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { isOrgBillingBlocked, fetchOrgBillingStatus } from '@/lib/payments/billing-gate'
import { generatePostServiceCheckinMessage, generateWinbackMessage, isWinbackEligible, WINBACK_COOLDOWN_DAYS } from '@/lib/receptionist/care'
import type { AgentConfig, Appointment, Customer, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Pós-venda + fidelização da Recepcionista (v1, 2026-08-26) — achado real
 * da auditoria pré-lançamento: ela nunca iniciava contato sozinha, então
 * clientes nunca recebiam um "como foi o serviço?" nem um "sentimos sua
 * falta" quando somem. Roda 1x/dia (mesma limitação de cron horário dos
 * demais crons do produto, ver manager-agenda-digest/route.ts) e faz
 * duas coisas por unidade, pelo canal de WhatsApp dedicado da
 * Recepcionista:
 *   1) check-in de satisfação pro serviço concluído ONTEM (calculado no
 *      timezone da unidade) — idempotente por construção: uma janela de
 *      exatamente 1 dia só cai na execução de hoje, nunca se repete.
 *   2) "sentimos sua falta" pra cliente ativo sem serviço concluído há
 *      mais de WINBACK_AFTER_DAYS — com cooldown de WINBACK_COOLDOWN_DAYS
 *      via system_events (hasRecentEventForContact) pra não mandar todo
 *      dia enquanto o cliente continuar sumido.
 * Org com cobrança bloqueada (billing-gate) não recebe nada — mesma regra
 * do resto do produto.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') ?? ''

  if (!cronSecret) {
    console.error('[cron/receptionist-care] CRON_SECRET não configurado — cron desabilitado.')
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    console.error('[cron/receptionist-care] SUPABASE_SERVICE_ROLE_KEY não configurada.')
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    console.error('[cron/receptionist-care] OPENAI_API_KEY não configurada — cron pulado.')
    return NextResponse.json({ error: 'OPENAI_API_KEY não configurada.' }, { status: 500 })
  }

  const { data: unitsData, error: unitsError } = await supabase.from('units').select('*').eq('is_active', true)
  if (unitsError) {
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'cron',
      eventType: 'receptionist_care_query_failed',
      message: `Cron de pós-venda/fidelização abortado: falha ao buscar unidades: ${unitsError.message}`,
    })
    return NextResponse.json({ error: 'Falha ao buscar unidades.' }, { status: 500 })
  }

  const units = (unitsData ?? []) as Unit[]
  let checkinsSent = 0
  let winbacksSent = 0
  let errors = 0

  for (const unit of units) {
    try {
      const billingStatus = await fetchOrgBillingStatus(supabase, unit.org_id)
      if (isOrgBillingBlocked(billingStatus)) continue

      const result = await runCareForUnit(supabase, unit, apiKey)
      checkinsSent += result.checkins
      winbacksSent += result.winbacks
    } catch (error) {
      errors += 1
      await logSystemEvent(supabase, {
        level: 'error',
        source: 'cron',
        eventType: 'receptionist_care_failed',
        message: `Falha no cron de pós-venda/fidelização da unidade "${unit.name}": ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        orgId: unit.org_id,
        unitId: unit.id,
      })
    }
  }

  await logSystemEvent(supabase, {
    level: 'info',
    source: 'cron',
    eventType: 'receptionist_care_run',
    message: `Cron de pós-venda/fidelização executado: ${checkinsSent} check-ins, ${winbacksSent} mensagens de retorno, ${errors} erros.`,
    metadata: { units: units.length },
  })

  return NextResponse.json({ ok: true, checkinsSent, winbacksSent, errors })
}

async function runCareForUnit(
  supabase: SupabaseClient,
  unit: Unit,
  apiKey: string,
): Promise<{ checkins: number; winbacks: number }> {
  const { data: configData } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('agent_type', 'receptionist')
    .eq('is_active', true)
    .maybeSingle()
  const agentConfig = configData as AgentConfig | null
  if (!agentConfig) return { checkins: 0, winbacks: 0 }

  const channel = await resolveWhatsappChannel(supabase, unit, 'receptionist')
  if (!channel) return { checkins: 0, winbacks: 0 }

  const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unit.org_id)

  const checkins = await sendPostServiceCheckins(supabase, unit, agentConfig, organizationProfile, channel.config, apiKey)
  const winbacks = await sendWinbacks(supabase, unit, agentConfig, organizationProfile, channel.config, apiKey)
  return { checkins, winbacks }
}

async function sendPostServiceCheckins(
  supabase: SupabaseClient,
  unit: Unit,
  agentConfig: AgentConfig,
  organizationProfile: Record<string, unknown> | null,
  channelConfig: EvolutionUnitConfig,
  apiKey: string,
): Promise<number> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const dateStr = localDateString(yesterday, unit.timezone)
  const startOfDay = zonedTimeToUtc(dateStr, '00:00', unit.timezone)
  const endOfDay = zonedTimeToUtc(dateStr, '23:59', unit.timezone)

  const { data } = await supabase
    .from('appointments')
    .select('id, customer_id, service_id, starts_at, status')
    .eq('unit_id', unit.id)
    .eq('status', 'completed')
    .gte('starts_at', startOfDay.toISOString())
    .lte('starts_at', endOfDay.toISOString())

  const appointments = (data ?? []) as Pick<Appointment, 'id' | 'customer_id' | 'service_id' | 'starts_at' | 'status'>[]
  if (appointments.length === 0) return 0

  const customerIds = [...new Set(appointments.map((a) => a.customer_id))]
  const serviceIds = [...new Set(appointments.map((a) => a.service_id).filter((id): id is string => !!id))]

  const [{ data: customersData }, { data: servicesData }] = await Promise.all([
    supabase.from('customers').select('id, name, phone').in('id', customerIds),
    serviceIds.length > 0
      ? supabase.from('services').select('id, name').in('id', serviceIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const customerById = new Map(
    ((customersData ?? []) as Pick<Customer, 'id' | 'name' | 'phone'>[]).map((c) => [c.id, c]),
  )
  const serviceNameById = new Map(((servicesData ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]))

  let sent = 0
  for (const appointment of appointments) {
    const customer = customerById.get(appointment.customer_id)
    if (!customer?.phone) continue
    try {
      const text = await generatePostServiceCheckinMessage({
        apiKey,
        agentConfig,
        unit,
        organizationProfile,
        customerName: customer.name,
        serviceName: appointment.service_id ? (serviceNameById.get(appointment.service_id) ?? null) : null,
      })
      await sendWhatsAppMessage(channelConfig, customer.phone, text)
      await logSystemEvent(supabase, {
        level: 'info',
        source: 'cron',
        eventType: 'receptionist_post_service_checkin_sent',
        message: `Check-in pós-serviço enviado a "${customer.name}".`,
        orgId: unit.org_id,
        unitId: unit.id,
        metadata: { contact_id: customer.id, appointment_id: appointment.id },
      })
      sent += 1
    } catch (error) {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'cron',
        eventType: 'receptionist_post_service_checkin_failed',
        message: `Falha ao enviar check-in pós-serviço: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        orgId: unit.org_id,
        unitId: unit.id,
        metadata: { contact_id: customer.id, appointment_id: appointment.id },
      })
    }
  }
  return sent
}

async function sendWinbacks(
  supabase: SupabaseClient,
  unit: Unit,
  agentConfig: AgentConfig,
  organizationProfile: Record<string, unknown> | null,
  channelConfig: EvolutionUnitConfig,
  apiKey: string,
): Promise<number> {
  const { data: customersData } = await supabase
    .from('customers')
    .select('id, name, phone, marketing_opt_out')
    .eq('unit_id', unit.id)
    .eq('status', 'active')
    .eq('marketing_opt_out', false)
  const customers = (customersData ?? []) as Array<Pick<Customer, 'id' | 'name' | 'phone'> & { marketing_opt_out: boolean }>
  if (customers.length === 0) return 0

  const customerIds = customers.map((c) => c.id)
  const { data: appointmentsData } = await supabase
    .from('appointments')
    .select('customer_id, starts_at')
    .in('customer_id', customerIds)
    .eq('status', 'completed')
    .order('starts_at', { ascending: false })

  const lastCompletedByCustomer = new Map<string, string>()
  for (const row of (appointmentsData ?? []) as { customer_id: string; starts_at: string }[]) {
    // Ordenado desc — a primeira ocorrência de cada customer_id já é a mais recente.
    if (!lastCompletedByCustomer.has(row.customer_id)) lastCompletedByCustomer.set(row.customer_id, row.starts_at)
  }

  const now = new Date()
  let sent = 0
  for (const customer of customers) {
    if (!customer.phone) continue
    const lastCompleted = lastCompletedByCustomer.get(customer.id) ?? null
    if (!isWinbackEligible(lastCompleted, now)) continue

    const alreadySentRecently = await hasRecentEventForContact(supabase, {
      eventType: 'receptionist_winback_sent',
      unitId: unit.id,
      contactId: customer.id,
      windowMinutes: WINBACK_COOLDOWN_DAYS * 24 * 60,
    })
    if (alreadySentRecently) continue

    try {
      const text = await generateWinbackMessage({ apiKey, agentConfig, unit, organizationProfile, customerName: customer.name })
      await sendWhatsAppMessage(channelConfig, customer.phone, text)
      await logSystemEvent(supabase, {
        level: 'info',
        source: 'cron',
        eventType: 'receptionist_winback_sent',
        message: `Mensagem de retorno enviada a "${customer.name}" (mais de ${WINBACK_COOLDOWN_DAYS} dias sem repetir).`,
        orgId: unit.org_id,
        unitId: unit.id,
        metadata: { contact_id: customer.id },
      })
      sent += 1
    } catch (error) {
      await logSystemEvent(supabase, {
        level: 'warning',
        source: 'cron',
        eventType: 'receptionist_winback_failed',
        message: `Falha ao enviar mensagem de retorno: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        orgId: unit.org_id,
        unitId: unit.id,
        metadata: { contact_id: customer.id },
      })
    }
  }
  return sent
}
