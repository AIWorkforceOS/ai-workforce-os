-- ============================================================
-- AI Workforce OS — Migration 11: conexão self-service de contas
-- de anúncio (Traffic Specialist)
--
-- Até aqui, credenciais de Meta/Google Ads chegavam por e-mail e eram
-- coladas manualmente pela equipe Alizo em ad_accounts. Esta migration
-- não muda esse mecanismo de armazenamento (mesmas colunas, mesmo RLS
-- de payment_gateway_settings-like: leitura/escrita restrita por unit +
-- is_org_admin) — só adiciona os campos opcionais que o fluxo de
-- self-service do Google Ads passa a aceitar, para contas que trazem
-- sua própria credencial de app OAuth em vez de usar a MCC da Alizo.
-- ============================================================

alter table ad_accounts
  add column if not exists google_developer_token text,
  add column if not exists google_client_id text,
  add column if not exists google_client_secret text;

comment on column ad_accounts.google_developer_token is
  'Override opcional por conta do developer token da Google Ads API. Null = usa GOOGLE_ADS_DEVELOPER_TOKEN (MCC da Alizo).';
comment on column ad_accounts.google_client_id is
  'Override opcional por conta do OAuth client ID. Null = usa GOOGLE_ADS_CLIENT_ID (app da Alizo).';
comment on column ad_accounts.google_client_secret is
  'Override opcional por conta do OAuth client secret. Null = usa GOOGLE_ADS_CLIENT_SECRET (app da Alizo).';
