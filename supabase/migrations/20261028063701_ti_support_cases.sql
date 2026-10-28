-- Chamados duráveis do funcionário TI. O diagnóstico é somente leitura;
-- qualquer reparo exige uma proposta e autorização explícita registradas.
create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  protocol text not null unique default ('TI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  source_system text not null default 'ai_workforce' check (source_system in ('ai_workforce', 'partner')),
  external_reference text,
  reporter_user_id uuid references public.users(id) on delete set null,
  reporter_name text,
  reporter_email text,
  reporter_phone text,
  channel text not null default 'dashboard' check (channel in ('dashboard', 'whatsapp', 'sms', 'email', 'partner_api')),
  category text not null default 'bug' check (category in ('guidance', 'bug', 'access', 'integration', 'billing', 'other')),
  title text not null,
  description text not null,
  diagnosis text,
  status text not null default 'open' check (status in ('open', 'investigating', 'awaiting_authorization', 'authorized', 'repairing', 'resolved', 'closed')),
  repair_proposal text,
  repair_scope jsonb not null default '{}',
  authorization_granted_at timestamptz,
  authorization_granted_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_cases_authorization_consistent check (
    (authorization_granted_at is null and authorization_granted_by is null)
    or (authorization_granted_at is not null and authorization_granted_by is not null)
  )
);

create table public.support_case_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  author_type text not null check (author_type in ('user', 'agent', 'technician', 'system')),
  author_user_id uuid references public.users(id) on delete set null,
  content text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index support_cases_org_status_idx on public.support_cases(org_id, status, created_at desc);
create index support_cases_unit_created_idx on public.support_cases(unit_id, created_at desc);
create unique index support_cases_external_reference_uq
  on public.support_cases(source_system, external_reference)
  where external_reference is not null;
create index support_case_messages_case_created_idx on public.support_case_messages(case_id, created_at);

create trigger support_cases_updated_at before update on public.support_cases
  for each row execute function public.update_updated_at();

alter table public.support_cases enable row level security;
alter table public.support_case_messages enable row level security;

create policy support_cases_select on public.support_cases
  for select to authenticated
  using (public.is_super_admin() or public.is_org_member(org_id));

create policy support_cases_insert on public.support_cases
  for insert to authenticated
  with check (public.is_super_admin() or public.is_org_member(org_id));

-- Atualizações passam por rotas server-side que validam papel, organização,
-- transição de estado e autorização. Não existe update direto pelo Data API.
create policy support_cases_update_super_admin on public.support_cases
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy support_case_messages_select on public.support_case_messages
  for select to authenticated
  using (public.is_super_admin() or public.is_org_member(org_id));

create policy support_case_messages_insert on public.support_case_messages
  for insert to authenticated
  with check (
    (public.is_super_admin() or public.is_org_member(org_id))
    and exists (
      select 1 from public.support_cases c
      where c.id = case_id and c.org_id = support_case_messages.org_id
    )
  );

grant select, insert on public.support_cases to authenticated;
grant select, insert on public.support_case_messages to authenticated;
revoke update, delete on public.support_cases from authenticated;
revoke update, delete on public.support_case_messages from authenticated;

comment on table public.support_cases is
  'Chamados do funcionário TI. Diagnóstico não autoriza reparo; authorization_granted_at/by registra consentimento explícito.';
