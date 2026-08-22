// Server-only: lê process.env para reportar o que está configurado.
// Nunca exponha os valores das chaves — apenas presença/ausência.

export type IntegrationKey =
  | 'supabase_service'
  | 'openai'
  | 'evolution'
  | 'google_maps'
  | 'resend'
  | 'resend_inbound'
  | 'intake'
  | 'cron'
  | 'meta_ads'
  | 'meta_business_manager'
  | 'meta_app_oauth'
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

/**
 * ID do Business Manager da Alizo, usado nos fluxos self-service de Meta
 * Ads e Facebook/Instagram para o cliente compartilhar a conta de anúncio
 * ou a Página como Parceiro (sem precisar gerar nenhum token). Ainda não
 * configurado até o Business Manager da Alizo existir — degrada
 * graciosamente (null) em vez de quebrar as telas de conexão.
 */
export function getMetaBusinessManagerId(): string | null {
  return process.env.META_BUSINESS_MANAGER_ID?.trim() || null
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
      label: 'OpenAI (AI Sales Representative + chat Kai)',
      configured: has('OPENAI_API_KEY'),
      detail: 'Gera as respostas do AI Sales Representative no WhatsApp e do consultor Kai na landing page. Env: OPENAI_API_KEY',
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
      key: 'resend_inbound',
      label: 'Resend Receiving (resposta do lead por e-mail)',
      configured: has('EMAIL_INBOUND_DOMAIN') && has('RESEND_WEBHOOK_SECRET'),
      detail:
        'Sem isso, quando um lead responde o e-mail de prospecção, a resposta NÃO chega no Sales Rep nem em ninguém (a menos que a unidade tenha um e-mail de resposta configurado manualmente). Exige MX de Receiving configurado no domínio no Resend + o webhook assinado. Env: EMAIL_INBOUND_DOMAIN + RESEND_WEBHOOK_SECRET',
      testable: false,
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
      key: 'meta_business_manager',
      label: 'Business Manager da Alizo (parceria sem token do cliente)',
      configured: has('META_BUSINESS_MANAGER_ID'),
      detail: 'ID do Business Manager da Alizo, mostrado ao cliente para compartilhar conta de anúncio/Página como Parceiro (sem gerar token). Env: META_BUSINESS_MANAGER_ID — ver docs/setup/traffic-apis-setup.md',
      testable: false,
    },
    {
      key: 'meta_app_oauth',
      label: 'Login com Facebook (Gestor de Conteúdo)',
      configured: has('META_APP_ID') && has('META_APP_SECRET'),
      detail: 'App da Meta com o produto Facebook Login habilitado — sem isso, "Conectar com Facebook" na tela de Conteúdo não funciona (o método manual continua disponível). Env: META_APP_ID + META_APP_SECRET — ver docs/setup/content-oauth-setup.md',
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
