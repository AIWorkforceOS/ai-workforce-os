-- ============================================================
-- Ajustes de lançamento (2026-07-14)
--
-- 1. plans: nova tabela de preços (Starter 497 / Pro 997 /
--    Enterprise sob consulta), coluna slug e features honestas —
--    descrevem o que o produto entrega hoje, sem cotas inventadas.
-- 2. payment_gateway_settings: credenciais das processadoras de
--    pagamento por região (BR/US), preenchidas pelo super admin
--    no painel interno. Ficam vazias até a processadora ser
--    escolhida e configurada.
-- 3. financial_records: moeda (BRL/USD) e método de pagamento,
--    para o checkout dos EUA registrar cobrança em dólar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PLANS — slug + preços de lançamento
-- ------------------------------------------------------------
alter table plans add column if not exists slug text;

update plans set slug = lower(name) where slug is null;

create unique index if not exists plans_slug_idx on plans(slug);

-- Starter: R$497 — 1 unidade, 1 funcionário digital
update plans set
  price_monthly = 497,
  max_units = 1,
  max_agents = 1,
  description = 'Para empresas que estão começando a automatizar',
  features = '[
    "1 unidade / localização",
    "1 funcionário digital ativo",
    "Atendimento e qualificação no WhatsApp 24/7",
    "Prospecção de empresas via Google Maps",
    "Follow-up automático de leads",
    "Dashboard de resultados em tempo real",
    "Suporte por e-mail"
  ]'::jsonb
where lower(name) = 'starter';

-- Pro: R$997 — até 5 unidades, os 3 funcionários disponíveis
update plans set
  price_monthly = 997,
  max_units = 5,
  max_agents = 3,
  description = 'Para operações em crescimento que precisam de escala',
  features = '[
    "Até 5 unidades / localizações",
    "Até 3 funcionários digitais (SDR, RH e Tráfego)",
    "WhatsApp multi-unidade integrado",
    "Prospecção de empresas via Google Maps",
    "Follow-up automático de leads",
    "Funil de vendas (CRM) completo",
    "Suporte prioritário",
    "Configuração assistida pela nossa equipe"
  ]'::jsonb
where lower(name) = 'pro';

-- Enterprise: sob consulta (price 0 = sem preço fixo exibido)
update plans set
  price_monthly = 0,
  description = 'Para grandes redes — escopo e preço sob consulta',
  features = '[
    "Unidades ilimitadas",
    "Todos os funcionários digitais",
    "Onboarding e configuração dedicados",
    "Suporte dedicado",
    "Condições comerciais personalizadas"
  ]'::jsonb
where lower(name) = 'enterprise';

-- ------------------------------------------------------------
-- 2. PAYMENT GATEWAY SETTINGS (config interna, super admin)
-- ------------------------------------------------------------
create table if not exists payment_gateway_settings (
  id uuid primary key default uuid_generate_v4(),
  region text not null check (region in ('BR', 'US')),
  provider text not null,              -- ex.: pagarme | asaas | mercado_pago | stripe | zelle_manual
  label text,                          -- nome de exibição no painel
  credentials jsonb not null default '{}'::jsonb,
  instructions text,                   -- ex.: dados da conta Zelle mostrados ao cliente
  notes text,                          -- anotações internas
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (region, provider)
);

alter table payment_gateway_settings enable row level security;

-- Credenciais de pagamento: exclusivo da equipe Alizo
drop policy if exists payment_gateway_settings_all on payment_gateway_settings;
create policy payment_gateway_settings_all on payment_gateway_settings
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'payment_gateway_settings_updated_at') then
    create trigger payment_gateway_settings_updated_at before update on payment_gateway_settings
      for each row execute function update_updated_at();
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. FINANCIAL RECORDS — moeda e método de pagamento
-- ------------------------------------------------------------
alter table financial_records
  add column if not exists currency text not null default 'BRL' check (currency in ('BRL', 'USD')),
  add column if not exists payment_method text;
