import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { Unit } from '@/lib/types'

const sendToLeadChannelsMock = vi.fn()

vi.mock('@/lib/channels/messaging-channel', () => ({
  sendToLeadChannels: (...args: unknown[]) => sendToLeadChannelsMock(...args),
}))

const {
  handleAppointmentBooked,
  handleAppointmentRescheduled,
  handleAppointmentCancelled,
  handleAppointmentNoShow,
} = await import('@/lib/scheduling/appointment-notifications')

// Molde de handleSalesDealHandoff (lib/sales/deal-handoff.ts): mensagem
// determinística (sem LLM), fail-safe e idempotente por coluna de
// timestamp. Cobre os 4 gatilhos contra um Supabase fake, sem depender
// de OPENAI_API_KEY nem de credenciais reais de WhatsApp/SMS/e-mail
// (sendToLeadChannels é mockado).

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Clínica Teste',
    slug: 'clinica-teste',
    whatsapp_instance_id: null,
    whatsapp_phone: null,
    email_from: null,
    email_reply_to: null,
    logo_url: null,
    region_city: 'São Paulo',
    region_state: 'SP',
    evolution_api_url: null,
    evolution_api_key: null,
    evolution_instance_name: null,
    messaging_channel: null,
    twilio_account_sid: null,
    twilio_auth_token: null,
    twilio_phone_number: null,
    default_conversation_language: null,
    intake_token: null,
    crm_integration_mode: 'native',
    smarter_crm_partner_token: null,
    recruiting_integration_mode: 'native',
    smarter_recruiting_partner_token: null,
    smarter_recruiting_company_id: null,
    smarter_marketing_partner_token: null,
    public_lead_intake_token: null,
    timezone: 'America/Sao_Paulo',
    business_hours: {},
    scheduling_settings: {},
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function seedAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    customer_id: 'cust-1',
    service_id: 'svc-1',
    employee_id: null,
    resource_id: null,
    starts_at: '2026-08-01T13:00:00.000Z',
    ends_at: '2026-08-01T14:00:00.000Z',
    status: 'scheduled',
    cancelled_at: null,
    cancellation_reason: null,
    source: 'manual',
    notes: null,
    custom_fields: {},
    confirmation_sent_at: null,
    reminder_sent_at: null,
    rescheduled_notified_at: null,
    cancelled_notified_at: null,
    no_show_notified_at: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const customer = { id: 'cust-1', name: 'Maria Silva', phone: '5511988887777', email: null }
const service = { id: 'svc-1', name: 'Consulta' }

beforeEach(() => {
  sendToLeadChannelsMock.mockReset()
  sendToLeadChannelsMock.mockResolvedValue([{ channel: 'whatsapp', ok: true }])
})

describe('handleAppointmentBooked', () => {
  it('envia confirmação e marca confirmation_sent_at; não envia de novo se chamado outra vez', async () => {
    const { supabase, db } = createFakeSupabase({
      appointments: [seedAppointment()],
      customers: [customer],
      services: [service],
    })
    const unit = makeUnit()

    await handleAppointmentBooked(supabase, { appointmentId: 'appt-1', unit })

    expect(sendToLeadChannelsMock).toHaveBeenCalledTimes(1)
    const text = sendToLeadChannelsMock.mock.calls[0]![0].text as string
    expect(text).toContain('Maria Silva')
    expect(text).toContain('Consulta')
    const appt1 = (db.appointments![0] as Record<string, unknown>)
    expect(appt1.confirmation_sent_at).toBeTruthy()

    await handleAppointmentBooked(supabase, { appointmentId: 'appt-1', unit })
    expect(sendToLeadChannelsMock).toHaveBeenCalledTimes(1) // idempotente
  })

  it('não envia quando confirmation_enabled é false', async () => {
    const { supabase } = createFakeSupabase({
      appointments: [seedAppointment()],
      customers: [customer],
      services: [service],
    })
    const unit = makeUnit({ scheduling_settings: { confirmation_enabled: false } })

    await handleAppointmentBooked(supabase, { appointmentId: 'appt-1', unit })
    expect(sendToLeadChannelsMock).not.toHaveBeenCalled()
  })

  it('mensagem em inglês quando a unidade é en', async () => {
    const { supabase } = createFakeSupabase({
      appointments: [seedAppointment()],
      customers: [customer],
      services: [service],
    })
    const unit = makeUnit({ default_conversation_language: 'en' })

    await handleAppointmentBooked(supabase, { appointmentId: 'appt-1', unit })
    const text = sendToLeadChannelsMock.mock.calls[0]![0].text as string
    expect(text).toMatch(/confirmed/i)
  })
})

describe('handleAppointmentRescheduled', () => {
  it('envia aviso e marca rescheduled_notified_at; reagendar de novo (reset) envia outra vez', async () => {
    const { supabase, db } = createFakeSupabase({
      appointments: [seedAppointment()],
      customers: [customer],
      services: [service],
    })
    const unit = makeUnit()

    await handleAppointmentRescheduled(supabase, { appointmentId: 'appt-1', unit })
    expect(sendToLeadChannelsMock).toHaveBeenCalledTimes(1)
    expect((db.appointments![0] as Record<string, unknown>).rescheduled_notified_at).toBeTruthy()

    // retry sem reset (ex.: fetch duplicado) não reenvia
    await handleAppointmentRescheduled(supabase, { appointmentId: 'appt-1', unit })
    expect(sendToLeadChannelsMock).toHaveBeenCalledTimes(1)

    // appointment-form-modal.tsx reseta o carimbo a cada reagendamento real
    ;(db.appointments![0] as Record<string, unknown>).rescheduled_notified_at = null
    await handleAppointmentRescheduled(supabase, { appointmentId: 'appt-1', unit })
    expect(sendToLeadChannelsMock).toHaveBeenCalledTimes(2)
  })
})

describe('handleAppointmentCancelled', () => {
  it('envia aviso e marca cancelled_notified_at; idempotente em retry', async () => {
    const { supabase, db } = createFakeSupabase({
      appointments: [seedAppointment({ status: 'cancelled', cancelled_at: new Date().toISOString() })],
      customers: [customer],
      services: [service],
    })
    const unit = makeUnit()

    await handleAppointmentCancelled(supabase, { appointmentId: 'appt-1', unit })
    expect(sendToLeadChannelsMock).toHaveBeenCalledTimes(1)
    expect((db.appointments![0] as Record<string, unknown>).cancelled_notified_at).toBeTruthy()

    await handleAppointmentCancelled(supabase, { appointmentId: 'appt-1', unit })
    expect(sendToLeadChannelsMock).toHaveBeenCalledTimes(1)
  })
})

describe('handleAppointmentNoShow', () => {
  it('não manda mensagem ao cliente — só registra system_event; idempotente', async () => {
    const { supabase, db } = createFakeSupabase({
      appointments: [seedAppointment({ status: 'no_show' })],
      customers: [customer],
      services: [service],
    })
    const unit = makeUnit()

    await handleAppointmentNoShow(supabase, { appointmentId: 'appt-1', unit })
    expect(sendToLeadChannelsMock).not.toHaveBeenCalled()
    const events = (db.system_events ?? []) as Record<string, unknown>[]
    expect(events.some((e) => e.event_type === 'appointment_no_show')).toBe(true)
    expect((db.appointments![0] as Record<string, unknown>).no_show_notified_at).toBeTruthy()

    await handleAppointmentNoShow(supabase, { appointmentId: 'appt-1', unit })
    expect((db.system_events ?? []).length).toBe(1) // idempotente, não duplica o evento
  })
})

describe('fail-safe', () => {
  it('erro no envio não lança — só registra system_event de erro', async () => {
    sendToLeadChannelsMock.mockRejectedValue(new Error('Evolution API fora do ar'))
    const { supabase, db } = createFakeSupabase({
      appointments: [seedAppointment()],
      customers: [customer],
      services: [service],
    })
    const unit = makeUnit()

    await expect(handleAppointmentBooked(supabase, { appointmentId: 'appt-1', unit })).resolves.toBeUndefined()
    const events = (db.system_events ?? []) as Record<string, unknown>[]
    expect(events.some((e) => e.event_type === 'appointment_confirmation_error')).toBe(true)
    // mesmo com falha de envio, o carimbo é marcado (sem retry automático nesta fase)
    expect((db.appointments![0] as Record<string, unknown>).confirmation_sent_at).toBeTruthy()
  })
})
