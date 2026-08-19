-- ============================================================
-- Arquitetura de pagamento por provider (2026-08-19)
--
-- Corrige o gap P0 da auditoria de 19/08: checkout/complete/route.ts
-- bloqueava TODO o cadastro (não só a cobrança) quando não havia
-- processadora ativa. A partir desta migration, o cadastro nunca é
-- bloqueado por falta de processadora — organizations.billing_status
-- passa a rastrear o ciclo de vida da cobrança de forma independente
-- do provisionamento de conta (que já acontece imediatamente hoje).
--
-- Não mexe em financial_records (schema/colunas intocados, só
-- consumido como já está) nem em nenhuma tabela financeira — pedido
-- explícito de manter o módulo financeiro fora desta tarefa.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ORGANIZATIONS — ciclo de vida de billing, independente do gate
-- ------------------------------------------------------------
alter table organizations
  add column if not exists billing_status text not null default 'trialing'
    check (billing_status in ('trialing', 'active', 'past_due', 'canceled', 'grace_period'));

alter table organizations
  add column if not exists billing_provider text,          -- 'asaas' | 'stripe' | null (nunca cobrado ainda)
  add column if not exists billing_provider_customer_ref text,
  add column if not exists billing_provider_subscription_ref text;

comment on column organizations.billing_status is
  'Estado do ciclo de cobrança — não controla criação de conta (isso já acontece no checkout, sempre). trialing = acesso liberado, sem cobrança confirmada ainda (padrão pra todo cadastro novo, inclusive beta/trial explícito). Atualizado pelos webhooks de pagamento (lib/payments/*).';

create index if not exists organizations_billing_status_idx on organizations(billing_status);

-- ------------------------------------------------------------
-- 2. WEBHOOK_EVENTS — idempotência de webhook por provider, genérica
--    (reaproveitável por Asaas, Stripe, e futuros providers)
-- ------------------------------------------------------------
create table if not exists webhook_events (
  id uuid primary key default uuid_generate_v4(),
  provider text not null,                 -- 'asaas' | 'stripe' | ...
  external_event_id text not null,
  event_type text,
  org_id uuid references organizations(id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  payload jsonb not null default '{}'::jsonb,
  unique (provider, external_event_id)
);

create index if not exists webhook_events_org_idx on webhook_events(org_id);

alter table webhook_events enable row level security;

drop policy if exists webhook_events_all on webhook_events;
create policy webhook_events_all on webhook_events
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- ------------------------------------------------------------
-- 3. CONVERSATIONS — fecha a corrida de dedupe de inbound (achado
--    P0.2 da auditoria: dedupe só em nível de aplicação até aqui)
-- ------------------------------------------------------------
create unique index if not exists conversations_external_message_uq
  on conversations(unit_id, external_message_id)
  where external_message_id is not null;
