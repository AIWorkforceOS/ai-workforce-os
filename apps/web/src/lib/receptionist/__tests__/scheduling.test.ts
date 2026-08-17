import { describe, expect, it } from 'vitest'
import { resolveServiceByName, findSlotAtTime, listSlotsText } from '@/lib/receptionist/scheduling'
import type { Service, Unit } from '@/lib/types'
import type { AvailableSlot } from '@/lib/slot-engine'

// Motor da Recepcionista (engine.ts/scheduling.ts/handoff.ts) não tinha
// NENHUM teste automatizado até agora — cobre aqui a parte determinística
// mais propensa a bug real: casar o nome de serviço citado em texto livre
// pelo cliente com o catálogo, e achar o slot pedido entre os livres. A
// geração de texto (LLM) fica fora de escopo destes testes (ver
// deal-handoff.e2e.test.ts para o padrão de teste que chama a OpenAI de
// verdade).

const unit: Unit = {
  id: 'unit-1',
  org_id: 'org-1',
  name: 'Unidade Teste',
  slug: 'unidade-teste',
  whatsapp_instance_id: null,
  whatsapp_phone: '5511999999999',
  email_from: null,
  email_reply_to: null,
  logo_url: null,
  email_accent_color: null,
  email_footer_note: null,
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
  billing_company_name: null,
  billing_address: null,
  billing_email: null,
  billing_phone: null,
  billing_payment_instructions: null,
  is_active: true,
  created_at: '',
  updated_at: '',
}

function makeService(overrides: Partial<Service>): Service {
  return {
    id: overrides.id ?? 'svc-1',
    org_id: 'org-1',
    unit_id: unit.id,
    name: overrides.name ?? 'Corte de cabelo',
    duration_minutes: 30,
    buffer_minutes: 0,
    capacity_per_slot: 1,
    price: null,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('resolveServiceByName', () => {
  const services = [makeService({ id: 's1', name: 'Corte de cabelo' }), makeService({ id: 's2', name: 'Manicure' })]

  it('casa por nome exato (case-insensitive)', () => {
    expect(resolveServiceByName(services, 'MANICURE')?.id).toBe('s2')
  })

  it('casa por substring nos dois sentidos', () => {
    expect(resolveServiceByName(services, 'corte')?.id).toBe('s1')
    expect(resolveServiceByName(services, 'quero fazer um corte de cabelo bem curto')?.id).toBe('s1')
  })

  it('retorna null quando não bate nada e há mais de um serviço', () => {
    expect(resolveServiceByName(services, 'depilação')).toBeNull()
  })

  it('retorna null quando o nome é vazio/nulo e há mais de um serviço', () => {
    expect(resolveServiceByName(services, null)).toBeNull()
    expect(resolveServiceByName(services, undefined)).toBeNull()
    expect(resolveServiceByName(services, '')).toBeNull()
  })

  it('cai pro único serviço ativo quando a unidade só tem um, mesmo sem nome citado', () => {
    const single = [makeService({ id: 'only', name: 'Estética facial' })]
    expect(resolveServiceByName(single, null)?.id).toBe('only')
    expect(resolveServiceByName(single, 'qualquer coisa não relacionada')?.id).toBe('only')
  })

  it('retorna null quando não há nenhum serviço', () => {
    expect(resolveServiceByName([], 'corte')).toBeNull()
  })
})

describe('findSlotAtTime', () => {
  const slots: AvailableSlot[] = [
    { starts_at: '2026-08-10T13:00:00.000Z', ends_at: '2026-08-10T13:30:00.000Z' }, // 10:00 America/Sao_Paulo
    { starts_at: '2026-08-10T14:00:00.000Z', ends_at: '2026-08-10T14:30:00.000Z' }, // 11:00 America/Sao_Paulo
  ]

  it('acha o slot que bate com o horário local pedido', () => {
    const found = findSlotAtTime(slots, unit, '10:00')
    expect(found?.starts_at).toBe('2026-08-10T13:00:00.000Z')
  })

  it('retorna null quando nenhum slot bate com o horário pedido', () => {
    expect(findSlotAtTime(slots, unit, '15:00')).toBeNull()
  })

  it('retorna null quando não há slots', () => {
    expect(findSlotAtTime([], unit, '10:00')).toBeNull()
  })
})

describe('listSlotsText', () => {
  it('lista os horários em pt-BR separados por vírgula', () => {
    const slots: AvailableSlot[] = [
      { starts_at: '2026-08-10T13:00:00.000Z', ends_at: '2026-08-10T13:30:00.000Z' },
      { starts_at: '2026-08-10T14:00:00.000Z', ends_at: '2026-08-10T14:30:00.000Z' },
    ]
    expect(listSlotsText(slots, unit, 'pt')).toBe('10:00, 11:00')
  })

  it('avisa quando não há horário livre nenhum (pt e en)', () => {
    expect(listSlotsText([], unit, 'pt')).toBe('nenhum horário livre nesse dia')
    expect(listSlotsText([], unit, 'en')).toBe('no open times that day')
  })

  it('limita a quantidade de horários listados (default 6)', () => {
    const slots: AvailableSlot[] = Array.from({ length: 10 }, (_, i) => ({
      starts_at: new Date(Date.UTC(2026, 7, 10, 13 + i, 0, 0)).toISOString(),
      ends_at: new Date(Date.UTC(2026, 7, 10, 13 + i, 30, 0)).toISOString(),
    }))
    const text = listSlotsText(slots, unit, 'pt')
    expect(text.split(', ')).toHaveLength(6)
  })
})
