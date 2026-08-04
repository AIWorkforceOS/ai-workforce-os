-- ============================================================
-- AI Workforce OS — Migration 52: Portal do Funcionário
--
-- Cada colaborador humano (employees) pode ganhar uma conta de login
-- (public.users com role='employee', employee_id preenchido). Essa
-- conta só acessa /portal-funcionario (guarda em código, não aqui) e,
-- via RLS, só enxerga os próprios agendamentos (appointments) e
-- lançamentos financeiros (service_records) — nunca os de outro
-- colaborador, mesmo dentro da mesma unidade.
--
-- A senha é escolhida pela unidade e enviada manualmente ao
-- funcionário (sem convite por e-mail automático nesta fase) — ver
-- POST /api/admin/employees/[id]/access.
--
-- O corte de dados a partir de 2026-08-01 (Alizo começou a operar o
-- funcionário em agosto/2026, sem necessidade de expor histórico
-- anterior) é aplicado na camada de aplicação (ver
-- lib/portal-funcionario/data.ts), não aqui — é uma decisão de
-- produto temporária, não uma regra de segurança permanente.
-- ============================================================

alter table users
  add column if not exists employee_id uuid references employees(id) on delete set null;

create index if not exists users_employee_idx on users(employee_id);

comment on column users.employee_id is
  'Preenchido = a conta é de um funcionário (role=''employee''): só vê a própria agenda/financeiro no Portal do Funcionário (ver current_app_employee_id() e as policies de appointments/service_records/employees). NULL nas demais roles.';

-- ------------------------------------------------------------
-- current_app_employee_id(): employee_id do usuário logado (NULL
-- para quem não é funcionário)
-- ------------------------------------------------------------
create or replace function public.current_app_employee_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select u.employee_id
  from public.users u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and u.is_active
  limit 1;
$$;

grant execute on function public.current_app_employee_id() to anon, authenticated;

-- ------------------------------------------------------------
-- EMPLOYEES: role='employee' só enxerga a própria linha (as demais
-- roles mantêm o comportamento anterior — toda a organização).
-- ------------------------------------------------------------
drop policy if exists employees_select on employees;
create policy employees_select on employees
  for select using (
    public.is_org_member(org_id)
    and (
      public.current_app_role() <> 'employee'
      or id = public.current_app_employee_id()
    )
  );

-- ------------------------------------------------------------
-- APPOINTMENTS: role='employee' só enxerga os próprios agendamentos.
-- ------------------------------------------------------------
drop policy if exists appointments_select on appointments;
create policy appointments_select on appointments
  for select using (
    public.can_access_unit(unit_id)
    and (
      public.current_app_role() <> 'employee'
      or employee_id = public.current_app_employee_id()
    )
  );

-- ------------------------------------------------------------
-- SERVICE_RECORDS: role='employee' só enxerga os próprios lançamentos.
-- ------------------------------------------------------------
drop policy if exists service_records_select on service_records;
create policy service_records_select on service_records
  for select using (
    public.can_access_unit(unit_id)
    and (
      public.current_app_role() <> 'employee'
      or employee_id = public.current_app_employee_id()
    )
  );
