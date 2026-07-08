-- ============================================================
-- AI Workforce OS — Migration 4: Schema fora de versionamento + eventos
--
-- Traz para o repositório as tabelas que existem no Supabase mas
-- não estavam em nenhuma migration (plans, employees,
-- financial_records e colunas extras de organizations), e adiciona:
--   - units.intake_token (webhook self-service de leads)
--   - system_events (log visível de falhas de configuração/integração)
--
-- Tudo usa "if not exists" para ser seguro em bancos onde as
-- tabelas já foram criadas manualmente.
-- ============================================================

-- ------------------------------------------------------------
-- TABELA: plans (planos comerciais exibidos na landing/cadastro)
-- ------------------------------------------------------------
create table if not exists plans (
  id uuid primary key default uuid_generate_v4(),
  name text unique not null,                     -- Starter | Pro | Enterprise
  price_monthly numeric(12,2) not null default 0,
  max_units int not null default 1,
  max_agents int not null default 1,
  max_leads_per_month int not null default 500,
  features jsonb not null default '[]',
  is_featured boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into plans (name, price_monthly, max_units, max_agents, max_leads_per_month, features, is_featured, sort_order)
values
  ('Starter', 297, 1, 1, 500, '["1 unidade", "1 agente IA", "500 leads/mês", "Suporte por e-mail"]', false, 1),
  ('Pro', 597, 5, 5, 2500, '["Até 5 unidades", "5 agentes IA", "2.500 leads/mês", "Suporte prioritário"]', true, 2),
  ('Enterprise', 1497, 999, 999, 100000, '["Unidades ilimitadas", "Agentes ilimitados", "Leads ilimitados", "Suporte dedicado"]', false, 3)
on conflict (name) do nothing;

-- ------------------------------------------------------------
-- ORGANIZATIONS: colunas usadas no cadastro de empresas
-- ------------------------------------------------------------
alter table organizations
  add column if not exists plan_id uuid references plans(id) on delete set null,
  add column if not exists monthly_fee numeric(12,2),
  add column if not exists billing_day int not null default 1;

-- ------------------------------------------------------------
-- TABELA: employees (colaboradores por empresa/unidade)
-- ------------------------------------------------------------
create table if not exists employees (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade,
  unit_id uuid references units(id) on delete set null,
  name text not null,
  email text,
  phone text,
  role text not null default 'staff',            -- admin | manager | staff | sdr | support
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employees_org_idx on employees(org_id);
create index if not exists employees_unit_idx on employees(unit_id);

-- ------------------------------------------------------------
-- TABELA: financial_records (cobranças, receitas e custos)
-- ------------------------------------------------------------
create table if not exists financial_records (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade,
  unit_id uuid references units(id) on delete set null,
  type text not null check (type in ('receivable', 'payable')),
  category text not null default 'other',        -- client_payment | system_cost | infrastructure | vendor | other
  description text not null,
  amount numeric(12,2) not null,
  due_date date,
  paid_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists financial_records_org_idx on financial_records(org_id);
create index if not exists financial_records_status_idx on financial_records(status);

-- ------------------------------------------------------------
-- UNITS: token de intake por unidade (webhook self-service)
-- ------------------------------------------------------------
alter table units
  add column if not exists intake_token uuid not null default gen_random_uuid();

create unique index if not exists units_intake_token_idx on units(intake_token);

-- ------------------------------------------------------------
-- TABELA: system_events (falhas de configuração/integração visíveis)
-- ------------------------------------------------------------
create table if not exists system_events (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade,
  unit_id uuid references units(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  level text not null default 'error' check (level in ('info', 'warning', 'error')),
  source text not null,                          -- openai | evolution | google_maps | anthropic | resend | cron | system
  event_type text not null,                      -- ex: missing_env, api_error, send_failed, follow_up_run
  message text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists system_events_created_idx on system_events(created_at desc);
create index if not exists system_events_org_idx on system_events(org_id);
create index if not exists system_events_level_idx on system_events(level);

-- ------------------------------------------------------------
-- TRIGGERS de updated_at
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'plans_updated_at') then
    create trigger plans_updated_at before update on plans
      for each row execute function update_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'employees_updated_at') then
    create trigger employees_updated_at before update on employees
      for each row execute function update_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'financial_records_updated_at') then
    create trigger financial_records_updated_at before update on financial_records
      for each row execute function update_updated_at();
  end if;
end $$;
