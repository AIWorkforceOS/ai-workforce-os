-- Launch readiness: fecha acesso anônimo restante e cria a fila auditável
-- usada pela Kai. Esta migration usa apenas DDL aditivo/revogável e não
-- remove dados existentes.

-- Tabelas internas da API de parceiros são exclusivamente server-side.
revoke all on table public.partner_api_keys from public, anon, authenticated;
revoke all on table public.partner_webhook_endpoints from public, anon, authenticated;
revoke all on table public.partner_events from public, anon, authenticated;
revoke all on table public.partner_webhook_deliveries from public, anon, authenticated;
grant all on table public.partner_api_keys to service_role;
grant all on table public.partner_webhook_endpoints to service_role;
grant all on table public.partner_events to service_role;
grant all on table public.partner_webhook_deliveries to service_role;

-- Helpers de identidade são necessários para policies de usuários logados,
-- mas nunca devem ser RPCs disponíveis sem autenticação.
revoke execute on function public.current_app_employee_id() from public, anon;
revoke execute on function public.current_app_role() from public, anon;
revoke execute on function public.current_app_unit_id() from public, anon;
revoke execute on function public.current_app_user_id() from public, anon;
revoke execute on function public.current_job_role() from public, anon;
revoke execute on function public.current_org_id() from public, anon;
revoke execute on function public.unit_org_id(uuid) from public, anon;

-- RPCs com efeito financeiro exigem sessão; a autorização fina permanece
-- dentro das próprias funções e das relações protegidas por RLS.
revoke execute on function public.consolidate_invoices(uuid, uuid, uuid[], text, date) from public, anon;
revoke execute on function public.generate_client_invoice(uuid, text, uuid[], text, date, text) from public, anon;
revoke execute on function public.generate_service_records_invoice(uuid, uuid, uuid[], text, date, text, date) from public, anon;
revoke execute on function public.register_service_record_payment(uuid, numeric, text) from public, anon;

create table if not exists public.kai_tasks (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete cascade,
  source_event_id uuid references public.system_events(id) on delete set null,
  kind text not null,
  title text not null,
  description text not null,
  status text not null default 'open' check (status in ('open','in_progress','waiting_human','resolved','dismissed')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  owner text not null default 'kai',
  due_at timestamptz,
  dedupe_key text not null,
  attempts integer not null default 0,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dedupe_key)
);

create index if not exists kai_tasks_org_status_due_idx on public.kai_tasks(org_id, status, due_at);
create index if not exists kai_tasks_unit_status_idx on public.kai_tasks(unit_id, status);
alter table public.kai_tasks enable row level security;

drop policy if exists kai_tasks_select on public.kai_tasks;
create policy kai_tasks_select on public.kai_tasks for select to authenticated
using (is_super_admin() or org_id = current_org_id());

drop policy if exists kai_tasks_update on public.kai_tasks;
create policy kai_tasks_update on public.kai_tasks for update to authenticated
using (is_super_admin() or (org_id = current_org_id() and is_org_admin()))
with check (is_super_admin() or (org_id = current_org_id() and is_org_admin()));

revoke all on table public.kai_tasks from anon;
grant select, update on table public.kai_tasks to authenticated;
grant all on table public.kai_tasks to service_role;

create or replace function public.kai_tasks_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.kai_tasks_set_updated_at() from public, anon, authenticated;
grant execute on function public.kai_tasks_set_updated_at() to service_role;

drop trigger if exists kai_tasks_updated_at on public.kai_tasks;
create trigger kai_tasks_updated_at before update on public.kai_tasks
for each row execute function public.kai_tasks_set_updated_at();

-- Não desliga funcionários que já estão atendendo: cria uma pendência crítica
-- para cada configuração legada ativa que ainda precisa da revisão guiada.
insert into public.kai_tasks (
  org_id, unit_id, kind, title, description, status, priority, owner, dedupe_key, metadata
)
select
  ac.org_id,
  ac.unit_id,
  'agent_certification_required',
  'Funcionário ativo requer certificação',
  'Este funcionário já estava ativo antes da certificação obrigatória. Revise o treinamento e aprove os cenários sem interromper o atendimento atual.',
  'waiting_human',
  'critical',
  'kai',
  'agent_certification:' || ac.id::text,
  jsonb_build_object('agent_config_id', ac.id, 'agent_type', ac.agent_type, 'certification_status', ac.certification_status)
from public.agent_configs ac
where ac.is_active = true
  and ac.certification_status <> 'ready'
on conflict (dedupe_key) do nothing;

comment on table public.kai_tasks is
  'Fila determinística e auditável da Kai. Eventos geram tarefas idempotentes; prompts nunca ampliam permissões.';
