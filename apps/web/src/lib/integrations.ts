// Server-only: lê process.env para reportar o que está configurado.
// Nunca exponha os valores das chaves — apenas presença/ausência.

export type IntegrationKey =
  | 'supabase_service'
  | 'openai'
  | 'anthropic'
  | 'evolution'
  | 'google_maps'
  | 'resend'
  | 'intake'
  | 'cron'

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
      label: 'OpenAI (agente SDR)',
      configured: has('OPENAI_API_KEY'),
      detail: 'Gera as respostas do agente SDR no WhatsApp. Env: OPENAI_API_KEY',
      testable: true,
    },
    {
      key: 'anthropic',
      label: 'Anthropic (chat do site)',
      configured: has('ANTHROPIC_API_KEY'),
      detail: 'Alimenta o consultor Kai na landing page. Env: ANTHROPIC_API_KEY',
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
  ]
}
