import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { createAdLead } from '@/lib/leads/ad-lead-intake'
import type { Unit } from '@/lib/types'

// Meta e Google reentregam o webhook de lead ads quando nosso handler não
// responde 200 a tempo (mesmo padrão de retry que já causou risco de
// bloqueio do WhatsApp — ver commit 95d0d03 / inbound-router.ts). Sem
// checar o id externo do lead (leadgen_id do Meta, lead_id do Google Ads)
// antes de inserir, uma reentrega criava um segundo lead e disparava um
// segundo primeiro contato por WhatsApp pro mesmo lead.

const { triggerFirstContact } = vi.hoisted(() => ({
  triggerFirstContact: vi.fn(async () => true),
}))

vi.mock('@/lib/leads/lead-intake', () => ({ triggerFirstContact }))
vi.mock('@/lib/sales/smarter-crm', () => ({ syncLeadToSmarterCrm: vi.fn(async () => {}) }))
vi.mock('@/lib/system-events', () => ({ logSystemEvent: vi.fn(async () => {}) }))

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit-1',
    org_id: 'org-1',
    name: 'Unidade Teste',
    slug: 'unidade-teste',
    whatsapp_instance_id: null,
    whatsapp_phone: '5511999999999',
    email_from: null,
    email_reply_to: null,
    logo_url: null,
    region_city: null,
    region_state: null,
    evolution_api_url: 'https://evo.test',
    evolution_api_key: 'key',
    evolution_instance_name: 'fake',
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
    billing_company_name: null,
    billing_address: null,
    billing_email: null,
    billing_phone: null,
    billing_payment_instructions: null,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('createAdLead — idempotência de reentrega de webhook (Meta/Google Lead Ads)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    triggerFirstContact.mockResolvedValue(true)
  })

  it('reentrega do mesmo webhook (mesmo leadgen_id/lead_id) não cria um segundo lead nem dispara um segundo primeiro contato', async () => {
    const unit = makeUnit()
    const { supabase, db } = createFakeSupabase({ leads: [] })

    const first = await createAdLead(supabase, {
      unit,
      lead: {
        name: 'João',
        phone: '5511988888888',
        email: null,
        source: 'meta_lead_ad',
        externalLeadId: 'LEADGEN-123',
      },
    })
    expect(first).not.toBeNull()
    expect(triggerFirstContact).toHaveBeenCalledTimes(1)
    expect(db.leads).toHaveLength(1)

    // Reentrega: Meta reenvia o mesmo webhook (mesmo leadgen_id).
    const second = await createAdLead(supabase, {
      unit,
      lead: {
        name: 'João',
        phone: '5511988888888',
        email: null,
        source: 'meta_lead_ad',
        externalLeadId: 'LEADGEN-123',
      },
    })

    expect(second).toBeNull()
    expect(triggerFirstContact).toHaveBeenCalledTimes(1)
    expect(db.leads).toHaveLength(1)
  })

  it('leads distintos (leadgen_id diferente) na mesma unidade são criados e contatados normalmente', async () => {
    const unit = makeUnit()
    const { supabase, db } = createFakeSupabase({ leads: [] })

    await createAdLead(supabase, {
      unit,
      lead: { name: 'João', phone: '5511988888888', email: null, source: 'meta_lead_ad', externalLeadId: 'LEADGEN-1' },
    })
    await createAdLead(supabase, {
      unit,
      lead: { name: 'Maria', phone: '5511977777777', email: null, source: 'meta_lead_ad', externalLeadId: 'LEADGEN-2' },
    })

    expect(triggerFirstContact).toHaveBeenCalledTimes(2)
    expect(db.leads).toHaveLength(2)
  })

  it('o mesmo external_lead_id em unidades diferentes não é tratado como duplicata', async () => {
    const unitA = makeUnit({ id: 'unit-a' })
    const unitB = makeUnit({ id: 'unit-b' })
    const { supabase, db } = createFakeSupabase({ leads: [] })

    await createAdLead(supabase, {
      unit: unitA,
      lead: { name: 'João', phone: '5511988888888', email: null, source: 'meta_lead_ad', externalLeadId: 'LEADGEN-1' },
    })
    await createAdLead(supabase, {
      unit: unitB,
      lead: { name: 'João', phone: '5511988888888', email: null, source: 'meta_lead_ad', externalLeadId: 'LEADGEN-1' },
    })

    expect(triggerFirstContact).toHaveBeenCalledTimes(2)
    expect(db.leads).toHaveLength(2)
  })
})
