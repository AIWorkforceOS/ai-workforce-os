-- Um único WhatsApp por unidade, com propriedade interna da conversa.
-- O cliente continua no mesmo número; o Alizo registra qual funcionário
-- digital deve continuar aquele contato e preserva o histórico de handoff.

create table if not exists whatsapp_conversation_routes (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  contact_key text not null,
  contact_phone text,
  contact_email text,
  agent_type text not null check (agent_type in ('triage', 'sdr', 'receptionist', 'recruiter', 'human')),
  previous_agent_type text check (previous_agent_type is null or previous_agent_type in ('triage', 'sdr', 'receptionist', 'recruiter', 'human')),
  handoff_reason text,
  handoff_summary text,
  status text not null default 'active' check (status in ('active', 'paused', 'closed')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, contact_key)
);

create index if not exists whatsapp_conversation_routes_unit_activity_idx
  on whatsapp_conversation_routes(unit_id, status, last_message_at desc);

create trigger whatsapp_conversation_routes_updated_at
  before update on whatsapp_conversation_routes
  for each row execute function update_updated_at();

alter table whatsapp_conversation_routes enable row level security;

drop policy if exists whatsapp_conversation_routes_select on whatsapp_conversation_routes;
create policy whatsapp_conversation_routes_select on whatsapp_conversation_routes
  for select to authenticated
  using (public.can_access_unit(unit_id));

drop policy if exists whatsapp_conversation_routes_write on whatsapp_conversation_routes;
create policy whatsapp_conversation_routes_write on whatsapp_conversation_routes
  for all to authenticated
  using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

grant select, insert, update, delete on whatsapp_conversation_routes to authenticated;

comment on table whatsapp_conversation_routes is
  'Responsável atual por contato no WhatsApp compartilhado da unidade. Permite continuidade e handoff entre triagem, Comercial, Recepção e Recrutamento sem trocar de número.';
