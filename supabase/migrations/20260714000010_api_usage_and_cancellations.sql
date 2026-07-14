-- ============================================================
-- Super Admin em tempo real (2026-07-14)
--
-- 1. api_usage_events: registro de uso por chamada de API externa
--    (OpenAI, Google Maps, Resend, Evolution). Guarda tokens/requests
--    e um custo ESTIMADO em USD calculado pela tabela de preços em
--    apps/web/src/lib/api-usage.ts — não é fatura real da API.
--    Alimenta os cards de custo do painel Super Admin.
-- 2. organizations.cancelled_at / cancellation_reason: timestamp de
--    cancelamento (preenchido quando o super admin desativa a org),
--    base para as métricas de cancelamento e do valor a devolver
--    dentro da garantia de 7 dias.
-- ============================================================

-- ------------------------------------------------------------
-- 1. API USAGE EVENTS (uso + custo estimado por chamada)
-- ------------------------------------------------------------
create table if not exists api_usage_events (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete set null,
  unit_id uuid references units(id) on delete set null,
  provider text not null check (provider in ('openai', 'google_maps', 'resend', 'evolution')),
  endpoint text not null,                        -- ex.: chat.completions | embeddings | places.textsearch | emails.send | message.sendText
  model text,                                    -- ex.: gpt-4o-mini | text-embedding-3-small
  input_tokens int,
  output_tokens int,
  total_tokens int,
  request_count int not null default 1,
  -- Custo estimado (USD) pela tabela de preços do código; 0 quando o
  -- provider não cobra por chamada (ex.: Evolution self-hosted).
  estimated_cost_usd numeric(14,6) not null default 0,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists api_usage_events_created_idx on api_usage_events(created_at desc);
create index if not exists api_usage_events_provider_idx on api_usage_events(provider, created_at desc);
create index if not exists api_usage_events_org_idx on api_usage_events(org_id);

alter table api_usage_events enable row level security;

-- Leitura: exclusivo da equipe Alizo (custos da plataforma inteira).
-- Escrita: apenas service role (as integrações gravam fora da sessão
-- do usuário), então nenhuma policy de insert para usuários.
drop policy if exists api_usage_events_select on api_usage_events;
create policy api_usage_events_select on api_usage_events
  for select using (public.is_super_admin());

-- ------------------------------------------------------------
-- 2. ORGANIZATIONS: timestamp de cancelamento
-- ------------------------------------------------------------
alter table organizations
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

create index if not exists organizations_cancelled_idx on organizations(cancelled_at) where cancelled_at is not null;
