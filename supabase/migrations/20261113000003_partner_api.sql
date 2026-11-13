-- ============================================================
-- AI Workforce OS — Migration 20261113000003: API de parceiro (chaves, webhooks, eventos)
--
-- Permite que um sistema externo autorizado (ex.: Sistema Smarter) use os
-- funcionários digitais do Alizo por HTTP, com chave por organização
-- (opcionalmente restrita a uma unidade) e escopos explícitos. Rotas em
-- /api/partner/v1/*.
--
-- Segurança: a chave em texto puro NUNCA é guardada — só o hash SHA-256 e
-- um prefixo curto para identificação. As tabelas só são acessadas pelo
-- service role (RLS ligado, sem policies para authenticated); a criação,
-- listagem e revogação de chaves passa por rotas de admin que checam a
-- organização do usuário.
-- ============================================================

create table if not exists partner_api_keys (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- null = vale para todas as unidades da organização
  unit_id uuid references units(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}',
  created_by uuid references users(id) on delete set null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists partner_api_keys_org_idx on partner_api_keys(org_id);

create table if not exists partner_webhook_endpoints (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  api_key_id uuid not null references partner_api_keys(id) on delete cascade,
  url text not null,
  -- usado para assinar (HMAC-SHA256) cada entrega; exibido uma única vez na criação
  secret text not null,
  -- ['*'] = todos os eventos
  events text[] not null default '{*}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists partner_webhook_endpoints_org_idx
  on partner_webhook_endpoints(org_id) where is_active;

create table if not exists partner_events (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid references units(id) on delete cascade,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- leitura por polling (GET /events?after=...) e limpeza por data
create index if not exists partner_events_org_created_idx
  on partner_events(org_id, created_at desc);

create table if not exists partner_webhook_deliveries (
  id uuid primary key default uuid_generate_v4(),
  endpoint_id uuid not null references partner_webhook_endpoints(id) on delete cascade,
  event_id uuid not null references partner_events(id) on delete cascade,
  ok boolean not null,
  status_code integer,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists partner_webhook_deliveries_endpoint_idx
  on partner_webhook_deliveries(endpoint_id, created_at desc);

alter table partner_api_keys enable row level security;
alter table partner_webhook_endpoints enable row level security;
alter table partner_events enable row level security;
alter table partner_webhook_deliveries enable row level security;
-- Sem policies de propósito: somente o service role (rotas do servidor) acessa.

comment on table partner_api_keys is
  'Chaves da API de parceiro (/api/partner/v1). Só o hash SHA-256 é guardado; scopes controlam o que a chave pode fazer; unit_id null = todas as unidades da org.';
comment on table partner_webhook_endpoints is
  'URLs https de parceiros que recebem eventos assinados com HMAC-SHA256 (header Alizo-Signature).';
comment on table partner_events is
  'Eventos emitidos para parceiros (também consultáveis por polling em GET /api/partner/v1/events).';
