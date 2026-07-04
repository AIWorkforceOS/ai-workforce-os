-- ============================================================
-- AI Workforce OS — Migration 2: Multi-tenant completo
-- Adiciona: organizations, users, agent_configs
-- Atualiza: units com org_id
-- ============================================================

-- ------------------------------------------------------------
-- TABELA: organizations (clientes da plataforma)
-- ------------------------------------------------------------
create table if not exists organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  plan text not null default 'starter',   -- starter | pro | enterprise
  is_active boolean not null default true,
  owner_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Smarter é o primeiro tenant (super admin)
insert into organizations (name, slug, plan, owner_email)
values ('Smarter Estágios', 'smarter', 'enterprise', 'viniciusmfp29@gmail.com')
on conflict (slug) do nothing;

-- ------------------------------------------------------------
-- TABELA: users (quem acessa a plataforma)
-- ------------------------------------------------------------
create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade,
  email text unique not null,
  name text,
  role text not null default 'admin',     -- super_admin | admin | viewer
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Vinicius como super admin
insert into users (org_id, email, name, role)
select id, 'viniciusmfp29@gmail.com', 'Vinicius Miranda', 'super_admin'
from organizations where slug = 'smarter'
on conflict (email) do nothing;

-- ------------------------------------------------------------
-- TABELA: agent_configs (configuração de cada agente por unidade)
-- ------------------------------------------------------------
create table if not exists agent_configs (
  id uuid primary key default uuid_generate_v4(),
  unit_id uuid references units(id) on delete cascade,
  agent_type text not null default 'sdr',     -- sdr | support | scheduling | onboarding
  persona_name text not null default 'Assistente',
  persona_tone text not null default 'professional',
  daily_limit int not null default 15,
  active_hours jsonb not null default '{"start": "08:00", "end": "18:00", "days": [1,2,3,4,5]}',
  escalation_rules jsonb not null default '{"after_messages": 5, "keywords": ["reunião", "contrato", "humano"]}',
  sectors text[] default array['tecnologia', 'industria', 'comercio', 'servicos'],
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- ATUALIZAR: units — adicionar org_id
-- ------------------------------------------------------------
alter table units
  add column if not exists org_id uuid references organizations(id) on delete set null;

update units
set org_id = (select id from organizations where slug = 'smarter')
where org_id is null;

-- ------------------------------------------------------------
-- TRIGGERS de updated_at
-- ------------------------------------------------------------
create trigger organizations_updated_at before update on organizations
  for each row execute function update_updated_at();

create trigger users_updated_at before update on users
  for each row execute function update_updated_at();

create trigger agent_configs_updated_at before update on agent_configs
  for each row execute function update_updated_at();

-- ------------------------------------------------------------
-- VIEW: dashboard_summary
-- ------------------------------------------------------------
create or replace view dashboard_summary as
select
  o.id as org_id,
  o.name as org_name,
  u.id as unit_id,
  u.name as unit_name,
  u.region_city,
  u.region_state,
  count(distinct l.id) as total_leads,
  count(distinct l.id) filter (where l.status = 'new') as new_leads,
  count(distinct l.id) filter (where l.status in ('contacted','replied','negotiating')) as active_leads,
  count(distinct l.id) filter (where l.status = 'won') as won_leads,
  count(distinct c.id) as total_conversations,
  count(distinct c.id) filter (where c.sent_at > now() - interval '24 hours') as conversations_today
from organizations o
left join units u on u.org_id = o.id
left join leads l on l.unit_id = u.id
left join conversations c on c.unit_id = u.id
group by o.id, o.name, u.id, u.name, u.region_city, u.region_state;
