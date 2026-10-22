-- Migration 105 — CRM: responsável pelo lead, retornos (follow-up), tarefas e linha do tempo. ADITIVA; NÃO aplicada até autorização.
--  * leads.owner_user_id: quem cuida do lead (NULL = sem responsável, como todos os atuais).
--  * lead_activities: linha do tempo única do lead — nota, ligação, mensagem, retorno agendado, tarefa e mudança de etapa.
--    Retorno/tarefa têm due_at (prazo) e done_at (concluído). Nada de envio automático: o lembrete aparece dentro do sistema.
-- Acesso: administrador da empresa na unidade (mesmo padrão de leads) e, em política restritiva, só administrador completo ou função Comercial
-- (Financeiro e Operacional não usam vendas — migration 104). Técnico e cliente nunca.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.leads add column if not exists owner_user_id uuid references public.users(id) on delete set null;
create index if not exists leads_owner_idx on public.leads (owner_user_id) where owner_user_id is not null;

create table if not exists public.lead_activities (
  id uuid primary key default uuid_generate_v4(),
  unit_id uuid not null references public.units(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null check (kind in ('note', 'call', 'message', 'followup', 'task', 'status_change')),
  body text,
  due_at timestamptz,
  done_at timestamptz,
  assigned_to uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint lead_activities_body_len check (body is null or char_length(body) <= 2000),
  constraint lead_activities_due_for_followup check (kind not in ('followup', 'task') or due_at is not null)
);
create index if not exists lead_activities_lead_idx on public.lead_activities (lead_id, created_at desc);
create index if not exists lead_activities_open_due_idx on public.lead_activities (unit_id, due_at) where done_at is null and kind in ('followup', 'task');

alter table public.lead_activities enable row level security;
drop policy if exists lead_activities_select on public.lead_activities;
create policy lead_activities_select on public.lead_activities
  for select using (public.can_access_unit(unit_id) and public.current_app_role() is distinct from 'employee' and public.current_app_role() is distinct from 'client');
drop policy if exists lead_activities_write on public.lead_activities;
create policy lead_activities_write on public.lead_activities
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());
drop policy if exists lead_activities_job_role on public.lead_activities;
create policy lead_activities_job_role on public.lead_activities
  as restrictive for all
  using (public.current_job_role() is null or public.current_job_role() = 'comercial')
  with check (public.current_job_role() is null or public.current_job_role() = 'comercial');
