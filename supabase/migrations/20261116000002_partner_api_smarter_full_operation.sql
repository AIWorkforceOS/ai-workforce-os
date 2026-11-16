-- Contrato operacional Smarter <-> Alizo. Mudanças aditivas e idempotentes.

alter table public.units
  add column if not exists external_id text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists owner_name text,
  add column if not exists address text,
  add column if not exists template_version integer not null default 1,
  add column if not exists partner_whatsapp_status text,
  add column if not exists deactivated_reason text;

create unique index if not exists units_org_external_id_uq
  on public.units (org_id, external_id) where external_id is not null;

create table if not exists public.partner_org_templates (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  template jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.partner_org_templates enable row level security;
revoke all on public.partner_org_templates from anon, authenticated;

create table if not exists public.partner_optouts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','email','sms','all')),
  destination text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (org_id, channel, destination)
);
create index if not exists partner_optouts_org_created_idx on public.partner_optouts(org_id, created_at desc);
alter table public.partner_optouts enable row level security;
revoke all on public.partner_optouts from anon, authenticated;

alter table public.partner_webhook_deliveries
  add column if not exists attempt_count integer not null default 1,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists last_attempt_at timestamptz not null default now();
create index if not exists partner_webhook_retry_idx
  on public.partner_webhook_deliveries(next_attempt_at)
  where ok = false and next_attempt_at is not null;

comment on column public.units.external_id is 'ID permanente da unidade no sistema parceiro; único dentro da organização.';
comment on table public.partner_org_templates is 'Template versionado aplicado automaticamente às unidades criadas pela API de parceiro.';
comment on table public.partner_optouts is 'Descadastros registrados pelo parceiro; acesso exclusivo via service role.';
