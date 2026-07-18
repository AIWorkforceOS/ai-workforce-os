-- ============================================================
-- AI Workforce OS — Migration 24: AI Receptionist (Fase 1)
--
-- Novo funcionário digital: agent_type = 'receptionist' na tabela
-- agent_configs já existente (sem mudança de schema nela — mesma
-- receita do Traffic Specialist/Recruiter, coluna text). Passa pela
-- mesma entrevista de contratação e pelo mesmo trigger
-- enforce_interview_before_activation (migration 012), sem mudança
-- necessária ali: o trigger já vale para qualquer agent_type.
--
--   customers — cadastro de clientes da unidade. Fase 1: só os
--   campos que já têm uso real (identificação + status/tags/origem).
--   Campos de fases futuras (documentos, agendamentos, financeiro,
--   avaliações) ficam de fora até os módulos que os alimentam
--   existirem.
--
--   lead_id — referência opcional ao lead de origem, usada só para
--   idempotência do handoff automático Sales→Receptionist (mesmo
--   padrão de job_openings.lead_id na migration 013): evita duplicar
--   o cliente em retry de webhook.
--
-- RLS: mesma receita das migrations 007/013 — leitura com
-- can_access_unit(unit_id); escrita humana com can_access_unit +
-- is_org_admin(); o handoff automático roda com service role, que
-- ignora RLS.
-- ============================================================

create table if not exists customers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  name text not null,
  phone text,
  email text,
  address text,
  city text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  tags text[] not null default '{}',
  source text not null default 'manual',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_unit_idx on customers(unit_id);
create index if not exists customers_org_idx on customers(org_id);
create index if not exists customers_lead_idx on customers(lead_id);
create index if not exists customers_status_idx on customers(unit_id, status);

create trigger customers_updated_at before update on customers
  for each row execute function update_updated_at();

alter table customers enable row level security;

drop policy if exists customers_select on customers;
create policy customers_select on customers
  for select using (public.can_access_unit(unit_id));

drop policy if exists customers_write on customers;
create policy customers_write on customers
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());
