import type { AgentConfig, Unit } from '@/lib/types'
import type { Candidate, JobOpening } from '@/lib/recruiter/types'

// Fixtures compartilhadas pelos testes do motor do Recruiter — evita
// repetir os mesmos objetos totalmente tipados (Unit/AgentConfig/JobOpening/
// Candidate têm muitos campos) em cada arquivo de teste.

export function makeUnit(overrides: Partial<Unit> = {}): Unit {
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

export function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'config-1',
    unit_id: 'unit-1',
    agent_type: 'recruiter',
    persona_name: 'Ana',
    persona_tone: 'professional',
    daily_limit: 50,
    active_hours: { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] },
    escalation_rules: { after_messages: 5, keywords: [] },
    sectors: [],
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

export function makeJob(overrides: Partial<JobOpening> = {}): JobOpening {
  return {
    id: 'job-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    lead_id: 'lead-1',
    title: 'Estagiário de Marketing',
    status: 'outreach',
    previous_status: null,
    profile: {},
    profile_missing_fields: [],
    target_shortlist_size: 3,
    urgency: 'normal',
    hiring_deadline: null,
    source: 'manual',
    stalled_since: null,
    follow_up_count: 0,
    selected_candidate_id: null,
    handed_off_to: null,
    smarter_recruiting_vacancy_id: null,
    public_application_token: 'token-abc',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

export function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'cand-1',
    org_id: 'org-1',
    source: 'manual',
    external_ref: null,
    name: 'Ana Souza',
    email: 'ana@example.com',
    phone: '11999998888',
    city: 'São Paulo',
    state: 'SP',
    course: 'Marketing',
    semester: 4,
    institution: 'PUC',
    skills: ['Excel'],
    languages: ['Português'],
    experience_summary: null,
    disc_profile: null,
    resume_url: null,
    profile_embedding: null,
    consent_status: 'granted',
    consent_at: null,
    opted_out: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}
