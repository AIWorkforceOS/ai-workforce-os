// Server-only: lê process.env para reportar o que está configurado.
// Nunca exponha os valores das chaves — apenas presença/ausência.

export type IntegrationKey =
  | 'supabase_service'
  | 'openai'
  | 'evolution'
  | 'google_maps'
  | 'resend'
  | 'intake'
  | 'cron'
  | 'meta_ads'
  | 'google_ads'
  | 'smarter_candidates'

export type IntegrationConfigStatus = {
  key: IntegrationKey
  label: string
  configured: boolean
  detail: string
  /** true quando a integração suporta teste de conexão ao vivo */
  testable: boolean
}

export function getIntegrationsConfigStatus(): IntegrationConfigStatus[] {
  const has = (name: string) => Boolean(process.env[name])

  return [
    {
      key: 'supabase_service',
      label: 'Supabase (service role)',
      configured: has('SUPABASE_SERVICE_ROLE_KEY'),
      detail: 'Necessário para webhooks do WhatsApp, intake de leads e cron. Env: SUPABASE_SERVICE_ROLE_KEY',
      testable: false,
    },
    {
      key: 'openai',
      label: 'OpenAI (agente SDR + chat Kai)',
      configured: has('OPENAI_API_KEY'),
      detail: 'Gera as respostas do agente SDR no WhatsApp e do consultor Kai na landing page. Env: OPENAI_API_KEY',
      testable: true,
    },
    {
      key: 'evolution',
      label: 'Evolution API (WhatsApp)',
      configured: has('EVOLUTION_API_URL') && has('EVOLUTION_API_KEY'),
      detail: 'Envio/recebimento de mensagens. Env globais: EVOLUTION_API_URL + EVOLUTION_API_KEY (ou por unidade)',
      testable: true,
    },
    {
      key: 'google_maps',
      label: 'Google Maps (prospecção)',
      configured: has('GOOGLE_MAPS_API_KEY'),
      detail: 'Busca de empresas por região. Env: GOOGLE_MAPS_API_KEY',
      testable: false,
    },
    {
      key: 'resend',
      label: 'Resend (e-mails de alerta)',
      configured: has('RESEND_API_KEY') && has('EMAIL_FROM_DOMAIN'),
      detail: 'Escalação para humano e alertas técnicos. Env: RESEND_API_KEY + EMAIL_FROM_DOMAIN',
      testable: true,
    },
    {
      key: 'intake',
      label: 'Webhook de intake (token global)',
      configured: has('INTAKE_SECRET'),
      detail: 'Token global do webhook /api/intake/lead (tokens por unidade funcionam mesmo sem ele). Env: INTAKE_SECRET',
      testable: false,
    },
    {
      key: 'cron',
      label: 'Cron de follow-up',
      configured: has('CRON_SECRET'),
      detail: 'Protege /api/cron/follow-up (Vercel envia automaticamente quando CRON_SECRET está definido). Env: CRON_SECRET',
      testable: false,
    },
    {
      key: 'meta_ads',
      label: 'Meta Ads (Traffic Specialist)',
      configured: has('META_SYSTEM_USER_TOKEN'),
      detail: 'Token global de system user do Meta Business (tokens por conta funcionam mesmo sem ele). Env: META_SYSTEM_USER_TOKEN — ver docs/setup/traffic-apis-setup.md',
      testable: false,
    },
    {
      key: 'google_ads',
      label: 'Google Ads (Traffic Specialist)',
      configured: has('GOOGLE_ADS_DEVELOPER_TOKEN') && has('GOOGLE_ADS_CLIENT_ID') && has('GOOGLE_ADS_CLIENT_SECRET'),
      detail: 'Developer token + OAuth do Google Ads (refresh token por conta no painel). Env: GOOGLE_ADS_DEVELOPER_TOKEN + GOOGLE_ADS_CLIENT_ID + GOOGLE_ADS_CLIENT_SECRET (+ GOOGLE_ADS_LOGIN_CUSTOMER_ID p/ MCC) — ver docs/setup/traffic-apis-setup.md',
      testable: false,
    },
    {
      key: 'smarter_candidates',
      label: 'API de candidatos Smarter (Recruiter)',
      configured: has('SMARTER_CANDIDATES_API_URL') && has('SMARTER_CANDIDATES_API_TOKEN'),
      detail: 'Banco de currículos da Smarter via API de parceiro autorizada. Sem ela, o sourcing usa só a base própria. Env: SMARTER_CANDIDATES_API_URL + SMARTER_CANDIDATES_API_TOKEN',
      testable: false,
    },
  ]
}
