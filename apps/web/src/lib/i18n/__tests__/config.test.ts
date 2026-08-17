import { describe, expect, it } from 'vitest'
import { unitDefaultLocale, conversationLanguageDirective, interviewLanguageDirective } from '@/lib/i18n/config'
import { buildSystemPrompt } from '@/lib/conversation-engine'
import type { AgentConfig, Unit } from '@/lib/types'

// A troca de idioma do Sales Rep só tinha cobertura via
// language-live.e2e.test.ts, que chama a OpenAI de verdade e por isso é
// gated atrás de RUN_LIVE_LANGUAGE=1 (não roda no CI normal) — o
// comportamento real do modelo nunca é verificado automaticamente em CI.
// Isto aqui não substitui aquele teste (não dá pra verificar
// deterministicamente o que um LLM vai responder), mas cobre a FIAÇÃO que
// alimenta o prompt: se alguém quebrar unitDefaultLocale ou esquecer de
// injetar a diretriz de idioma em buildSystemPrompt, este teste pega —
// sem precisar de API key nenhuma, roda sempre.

describe('unitDefaultLocale', () => {
  it('usa default_conversation_language quando configurado', () => {
    expect(unitDefaultLocale({ default_conversation_language: 'en' })).toBe('en')
    expect(unitDefaultLocale({ default_conversation_language: 'pt' })).toBe('pt')
  })

  it('cai para pt quando null (unidades de antes deste campo existir)', () => {
    expect(unitDefaultLocale({ default_conversation_language: null })).toBe('pt')
  })
})

describe('conversationLanguageDirective / interviewLanguageDirective', () => {
  it('nunca instrui o agente a anunciar a troca de idioma', () => {
    expect(conversationLanguageDirective('en')).toMatch(/nunca anuncie a troca/i)
    expect(interviewLanguageDirective('pt')).toMatch(/nunca anuncie a troca/i)
  })

  it('menciona o idioma certo por extenso conforme o locale', () => {
    expect(conversationLanguageDirective('en')).toMatch(/inglês \(EUA\)/)
    expect(conversationLanguageDirective('pt')).toMatch(/português do Brasil/)
  })
})

describe('buildSystemPrompt injeta a diretriz de idioma certa por unidade', () => {
  const baseConfig: AgentConfig = {
    id: 'cfg-1',
    unit_id: 'unit-1',
    agent_type: 'sdr',
    persona_name: 'Kai',
    persona_tone: 'friendly',
    daily_limit: 50,
    active_hours: { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] },
    escalation_rules: { after_messages: 999, keywords: [] },
    sectors: [],
    is_active: true,
    business_profile: {},
    interview_status: 'completed',
    interview_transcript: [],
    created_at: '',
    updated_at: '',
  }

  function makeUnit(defaultLanguage: 'pt' | 'en' | null): Unit {
    return {
      id: 'unit-1',
      org_id: 'org-1',
      name: 'Unidade Teste',
      slug: 'unidade-teste',
      whatsapp_instance_id: null,
      whatsapp_phone: null,
      email_from: null,
      email_reply_to: null,
      logo_url: null,
      email_accent_color: null,
      email_footer_note: null,
      region_city: null,
      region_state: null,
      evolution_api_url: null,
      evolution_api_key: null,
      evolution_instance_name: null,
      messaging_channel: null,
      twilio_account_sid: null,
      twilio_auth_token: null,
      twilio_phone_number: null,
      default_conversation_language: defaultLanguage,
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
  }

  it('unidade dos EUA (default_conversation_language "en") recebe a diretriz em inglês no prompt', () => {
    const prompt = buildSystemPrompt(baseConfig, makeUnit('en'))
    expect(prompt).toMatch(/inglês \(EUA\)/)
    expect(prompt).not.toMatch(/Responda por padrão em português do Brasil/)
  })

  it('unidade sem default_conversation_language cai para português no prompt', () => {
    const prompt = buildSystemPrompt(baseConfig, makeUnit(null))
    expect(prompt).toMatch(/português do Brasil/)
  })
})
