-- Agenda da REC por profissional/serviço + endurecimento encontrado na auditoria.

create table if not exists public.employee_service_skills (
  employee_id uuid not null references public.employees(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (employee_id, service_id)
);

create index if not exists employee_service_skills_service_idx on public.employee_service_skills(service_id);
create index if not exists employee_service_skills_org_idx on public.employee_service_skills(org_id);
create index if not exists employee_service_skills_unit_idx on public.employee_service_skills(unit_id);

alter table public.employee_service_skills enable row level security;

drop policy if exists employee_service_skills_select on public.employee_service_skills;
create policy employee_service_skills_select on public.employee_service_skills
  for select to authenticated
  using (public.can_access_unit(unit_id));

drop policy if exists employee_service_skills_write on public.employee_service_skills;
create policy employee_service_skills_write on public.employee_service_skills
  for all to authenticated
  using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (
    public.can_access_unit(unit_id)
    and public.is_org_admin()
    and org_id = public.current_org_id()
    and exists (
      select 1 from public.employees e
      where e.id = employee_id and e.unit_id = unit_id and e.org_id = org_id
    )
    and exists (
      select 1 from public.services s
      where s.id = service_id and s.unit_id = unit_id and s.org_id = org_id
    )
  );

-- As duas tabelas são internas e usadas exclusivamente pelo servidor.
-- A policy explícita de service_role documenta o modelo fail-closed e
-- elimina a ambiguidade de "RLS sem policy" apontada pelo advisor.
drop policy if exists product_price_cache_service_only on public.product_price_cache;
create policy product_price_cache_service_only on public.product_price_cache
  for all to service_role using (true) with check (true);
revoke all on public.product_price_cache from anon, authenticated;

drop policy if exists quote_budget_reservations_service_only on public.quote_budget_reservations;
create policy quote_budget_reservations_service_only on public.quote_budget_reservations
  for all to service_role using (true) with check (true);
revoke all on public.quote_budget_reservations from anon, authenticated;

-- Funções de trigger e exclusão administrativa não devem ser RPCs públicas.
revoke execute on function public.admin_delete_organization(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_organization(uuid) to service_role;
revoke execute on function public.appointments_guard_employee_write() from public, anon, authenticated;
revoke execute on function public.sync_service_record_payment_totals() from public, anon, authenticated;
revoke execute on function public.prevent_paid_invoice_financial_edit() from public, anon, authenticated;
revoke execute on function public.service_records_derive_payment_status() from public, anon, authenticated;

-- Search path fixo impede resolução de objetos maliciosos em funções auxiliares.
alter function public.can_access_unit(uuid) set search_path = pg_catalog, public;
alter function public.prevent_paid_invoice_financial_edit() set search_path = pg_catalog, public;
alter function public.service_records_derive_payment_status() set search_path = pg_catalog, public;

-- Índices dos relacionamentos mais acessados pela agenda, conversas,
-- agentes e automações. IF NOT EXISTS mantém aplicação idempotente.
create index if not exists appointments_org_id_idx on public.appointments(org_id);
create index if not exists appointments_service_id_idx on public.appointments(service_id);
create index if not exists appointments_resource_id_idx on public.appointments(resource_id);
create index if not exists agent_configs_unit_id_idx on public.agent_configs(unit_id);
create index if not exists api_usage_events_unit_id_idx on public.api_usage_events(unit_id);
create index if not exists conversations_lead_id_idx on public.conversations(lead_id);
create index if not exists content_posts_org_id_idx on public.content_posts(org_id);
create index if not exists content_instruction_history_org_id_idx on public.content_instruction_history(org_id);
create index if not exists content_instruction_history_unit_id_idx on public.content_instruction_history(unit_id);
