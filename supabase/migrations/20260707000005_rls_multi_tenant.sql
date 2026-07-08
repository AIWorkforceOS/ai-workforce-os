-- ============================================================
-- AI Workforce OS — Migration 5: Row Level Security multi-tenant
--
-- Habilita RLS em todas as tabelas com dados por-cliente e cria
-- políticas que restringem cada usuário à própria organização.
--
-- Resolução do usuário logado: o e-mail do JWT do Supabase Auth
-- é cruzado com public.users (que carrega org_id e role).
--   - role = 'super_admin'  → enxerga tudo (equipe Alizo)
--   - role = 'admin'        → lê e escreve dados da própria org
--   - role = 'viewer'       → só leitura dos dados da própria org
--
-- O service role (webhooks, cron) NÃO é afetado: ele ignora RLS
-- por definição no Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- FUNÇÕES auxiliares (security definer para evitar recursão de RLS)
-- ------------------------------------------------------------
create or replace function public.current_app_user_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select u.id
  from public.users u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and u.is_active
  limit 1;
$$;

create or replace function public.current_org_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select u.org_id
  from public.users u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and u.is_active
  limit 1;
$$;

create or replace function public.current_app_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select u.role
  from public.users u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and u.is_active
  limit 1;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable
as $$
  select coalesce(public.current_app_role() = 'super_admin', false);
$$;

create or replace function public.is_org_admin()
returns boolean
language sql stable
as $$
  select coalesce(public.current_app_role() in ('super_admin', 'admin'), false);
$$;

-- true se a linha pertence à org do usuário (ou se ele é super admin)
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql stable
as $$
  select public.is_super_admin()
      or (target_org is not null and target_org = public.current_org_id());
$$;

-- resolve a org de uma unidade sem esbarrar no RLS de units
create or replace function public.unit_org_id(target_unit uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select org_id from public.units where id = target_unit;
$$;

create or replace function public.can_access_unit(target_unit uuid)
returns boolean
language sql stable
as $$
  select public.is_super_admin()
      or (target_unit is not null and public.unit_org_id(target_unit) = public.current_org_id());
$$;

grant execute on function
  public.current_app_user_id(),
  public.current_org_id(),
  public.current_app_role(),
  public.is_super_admin(),
  public.is_org_admin(),
  public.is_org_member(uuid),
  public.unit_org_id(uuid),
  public.can_access_unit(uuid)
to anon, authenticated;

-- ------------------------------------------------------------
-- ORGANIZATIONS
-- ------------------------------------------------------------
alter table organizations enable row level security;

drop policy if exists organizations_select on organizations;
create policy organizations_select on organizations
  for select using (public.is_org_member(id));

drop policy if exists organizations_write on organizations;
create policy organizations_write on organizations
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- ------------------------------------------------------------
-- USERS
-- ------------------------------------------------------------
alter table users enable row level security;

drop policy if exists users_select on users;
create policy users_select on users
  for select using (
    public.is_super_admin()
    or org_id = public.current_org_id()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists users_insert on users;
create policy users_insert on users
  for insert with check (public.is_super_admin());

drop policy if exists users_update on users;
create policy users_update on users
  for update using (
    public.is_super_admin()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  with check (
    public.is_super_admin()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists users_delete on users;
create policy users_delete on users
  for delete using (public.is_super_admin());

-- ------------------------------------------------------------
-- UNITS
-- ------------------------------------------------------------
alter table units enable row level security;

drop policy if exists units_select on units;
create policy units_select on units
  for select using (public.is_org_member(org_id));

drop policy if exists units_write on units;
create policy units_write on units
  for all using (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin())
  )
  with check (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin())
  );

-- ------------------------------------------------------------
-- LEADS / CONVERSATIONS / PROSPECTING_JOBS / AGENT_CONFIGS
-- (escopados pela unidade → org)
-- ------------------------------------------------------------
alter table leads enable row level security;

drop policy if exists leads_select on leads;
create policy leads_select on leads
  for select using (public.can_access_unit(unit_id));

drop policy if exists leads_write on leads;
create policy leads_write on leads
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

alter table conversations enable row level security;

drop policy if exists conversations_select on conversations;
create policy conversations_select on conversations
  for select using (public.can_access_unit(unit_id));

drop policy if exists conversations_write on conversations;
create policy conversations_write on conversations
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

alter table prospecting_jobs enable row level security;

drop policy if exists prospecting_jobs_select on prospecting_jobs;
create policy prospecting_jobs_select on prospecting_jobs
  for select using (public.can_access_unit(unit_id));

drop policy if exists prospecting_jobs_write on prospecting_jobs;
create policy prospecting_jobs_write on prospecting_jobs
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

alter table agent_configs enable row level security;

drop policy if exists agent_configs_select on agent_configs;
create policy agent_configs_select on agent_configs
  for select using (public.can_access_unit(unit_id));

drop policy if exists agent_configs_write on agent_configs;
create policy agent_configs_write on agent_configs
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

-- ------------------------------------------------------------
-- EMPLOYEES / FINANCIAL_RECORDS (escopados direto por org)
-- Registros com org_id nulo (internos da Alizo) só aparecem
-- para super_admin.
-- ------------------------------------------------------------
alter table employees enable row level security;

drop policy if exists employees_select on employees;
create policy employees_select on employees
  for select using (public.is_org_member(org_id));

drop policy if exists employees_write on employees;
create policy employees_write on employees
  for all using (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin())
  )
  with check (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin())
  );

alter table financial_records enable row level security;

drop policy if exists financial_records_select on financial_records;
create policy financial_records_select on financial_records
  for select using (public.is_org_member(org_id));

drop policy if exists financial_records_write on financial_records;
create policy financial_records_write on financial_records
  for all using (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin())
  )
  with check (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin())
  );

-- ------------------------------------------------------------
-- PLANS (catálogo público — landing page usa anon)
-- ------------------------------------------------------------
alter table plans enable row level security;

drop policy if exists plans_select on plans;
create policy plans_select on plans
  for select using (true);

drop policy if exists plans_write on plans;
create policy plans_write on plans
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- ------------------------------------------------------------
-- SYSTEM_EVENTS (inserção via service role; leitura escopada)
-- ------------------------------------------------------------
alter table system_events enable row level security;

drop policy if exists system_events_select on system_events;
create policy system_events_select on system_events
  for select using (public.is_org_member(org_id));

-- Usuários podem registrar eventos da própria org (ex.: falha de
-- prospecção disparada pelo painel); alterar/apagar é só super admin.
drop policy if exists system_events_insert on system_events;
create policy system_events_insert on system_events
  for insert with check (public.is_org_member(org_id));

drop policy if exists system_events_update on system_events;
create policy system_events_update on system_events
  for update using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists system_events_delete on system_events;
create policy system_events_delete on system_events
  for delete using (public.is_super_admin());

-- ------------------------------------------------------------
-- VIEW dashboard_summary: executar com permissões de quem consulta
-- (senão a view ignoraria o RLS das tabelas base)
-- ------------------------------------------------------------
alter view public.dashboard_summary set (security_invoker = on);
