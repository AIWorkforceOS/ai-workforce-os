-- ============================================================
-- AI Workforce OS — Migration 26: Agenda Inteligente (Fase 2, sub-etapa 1/7)
--
-- Fundação de agendamento — SÓ schema, zero UI e zero lógica de
-- negócio. Decisões conservadoras confirmadas pelo usuário:
--   (b) "unidades" = tabela units existente (sem entidade nova de local);
--   (c) disponibilidade do profissional como jsonb em employees
--       (sem tabela própria de disponibilidade);
--   (e) sem recorrência/feriados/matching automático de waitlist.
--
--   units.timezone / business_hours / scheduling_settings —
--     fuso e configuração de agenda por unidade. Os jsonb começam
--     vazios; os defaults sensatos vivem nos accessors tipados
--     (apps/web/src/lib/scheduling.ts), nunca no banco.
--
--   employees.is_schedulable / availability — marca quais
--     colaboradores atendem agenda e a grade semanal deles
--     (mesmo formato jsonb de business_hours).
--
--   services — catálogo de serviços agendáveis da unidade
--     (duração, buffer entre atendimentos, capacidade por slot, preço).
--
--   resources — salas/equipamentos alocáveis a um agendamento.
--
--   appointments — o agendamento em si. Nesta fase é 100% operado
--     por UI (source = 'manual'); agendamento conversacional pela IA
--     fica pra Fase 3. confirmation_sent_at/reminder_sent_at são
--     preenchidos pelos templates automáticos de comunicação
--     (sub-etapas seguintes).
--
--   waitlist_entries — lista de espera simples, sem matching
--     automático nesta fase (status muda por ação humana na UI).
--
-- RLS: mesma receita das migrations 007/013/024 — leitura com
-- can_access_unit(unit_id); escrita com can_access_unit + is_org_admin().
-- ============================================================

-- ------------------------------------------------------------
-- UNITS: fuso horário + horário de funcionamento + config de agenda
-- ------------------------------------------------------------
alter table units
  add column if not exists timezone text not null default 'America/Sao_Paulo',
  add column if not exists business_hours jsonb not null default '{}',
  add column if not exists scheduling_settings jsonb not null default '{}';

comment on column units.timezone is
  'Fuso IANA da unidade (ex.: America/Sao_Paulo). Todos os horários de agenda são interpretados neste fuso.';
comment on column units.business_hours is
  'Grade semanal de funcionamento: { mon: [{start:"09:00",end:"18:00"}], ... }. Vazio = usar default do accessor getBusinessHours().';
comment on column units.scheduling_settings is
  'Configuração de agenda (intervalo de slot, antecedência mínima, lembretes...). Vazio = defaults do accessor getSchedulingSettings().';

-- ------------------------------------------------------------
-- EMPLOYEES: quem atende agenda + grade de disponibilidade
-- ------------------------------------------------------------
alter table employees
  add column if not exists is_schedulable boolean not null default false,
  add column if not exists availability jsonb not null default '{}';

comment on column employees.availability is
  'Grade semanal de disponibilidade do profissional, mesmo formato de units.business_hours. Vazio = segue o horário da unidade.';

-- ------------------------------------------------------------
-- TABELA: services (serviços agendáveis por unidade)
-- ------------------------------------------------------------
create table if not exists services (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  name text not null,
  duration_minutes int not null default 60,
  buffer_minutes int not null default 0,
  capacity_per_slot int not null default 1,
  price numeric(12,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists services_unit_idx on services(unit_id);
create index if not exists services_org_idx on services(org_id);

create trigger services_updated_at before update on services
  for each row execute function update_updated_at();

alter table services enable row level security;

drop policy if exists services_select on services;
create policy services_select on services
  for select using (public.can_access_unit(unit_id));

drop policy if exists services_write on services;
create policy services_write on services
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

-- ------------------------------------------------------------
-- TABELA: resources (salas e equipamentos alocáveis)
-- ------------------------------------------------------------
create table if not exists resources (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  type text not null check (type in ('room', 'equipment')),
  name text not null,
  capacity int not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resources_unit_idx on resources(unit_id);
create index if not exists resources_org_idx on resources(org_id);

create trigger resources_updated_at before update on resources
  for each row execute function update_updated_at();

alter table resources enable row level security;

drop policy if exists resources_select on resources;
create policy resources_select on resources
  for select using (public.can_access_unit(unit_id));

drop policy if exists resources_write on resources;
create policy resources_write on resources
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

-- ------------------------------------------------------------
-- TABELA: appointments (agendamentos)
-- ------------------------------------------------------------
create table if not exists appointments (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  service_id uuid references services(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  resource_id uuid references resources(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
  cancelled_at timestamptz,
  cancellation_reason text,
  source text not null default 'manual',
  notes text,
  custom_fields jsonb not null default '{}',
  confirmation_sent_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_ends_after_starts check (ends_at > starts_at)
);

create index if not exists appointments_unit_starts_idx on appointments(unit_id, starts_at);
create index if not exists appointments_customer_idx on appointments(customer_id);
create index if not exists appointments_employee_starts_idx on appointments(employee_id, starts_at);
create index if not exists appointments_unit_status_idx on appointments(unit_id, status);

create trigger appointments_updated_at before update on appointments
  for each row execute function update_updated_at();

alter table appointments enable row level security;

drop policy if exists appointments_select on appointments;
create policy appointments_select on appointments
  for select using (public.can_access_unit(unit_id));

drop policy if exists appointments_write on appointments;
create policy appointments_write on appointments
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

-- ------------------------------------------------------------
-- TABELA: waitlist_entries (lista de espera, sem matching automático)
-- ------------------------------------------------------------
create table if not exists waitlist_entries (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  service_id uuid references services(id) on delete set null,
  preferred_notes text,
  status text not null default 'waiting'
    check (status in ('waiting', 'notified', 'converted', 'removed')),
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists waitlist_entries_unit_status_idx on waitlist_entries(unit_id, status);
create index if not exists waitlist_entries_customer_idx on waitlist_entries(customer_id);

create trigger waitlist_entries_updated_at before update on waitlist_entries
  for each row execute function update_updated_at();

alter table waitlist_entries enable row level security;

drop policy if exists waitlist_entries_select on waitlist_entries;
create policy waitlist_entries_select on waitlist_entries
  for select using (public.can_access_unit(unit_id));

drop policy if exists waitlist_entries_write on waitlist_entries;
create policy waitlist_entries_write on waitlist_entries
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());
