-- Migration 101 — Perfil do cliente (Facility) para as ordens de serviço. ADITIVA; NÃO aplicada até autorização.
-- Cada cliente atendido (ex.: "360 Service Provider") tem logo e dados próprios; o PDF da WO (Sign Off) passa a sair com os dados do CLIENTE da ordem.
-- A chave é o nome do cliente já usado em customers.client_company (comparação sem diferenciar maiúsculas/minúsculas). Sem perfil, o PDF segue como hoje (360).
-- Leitura: qualquer pessoa da empresa (o técnico precisa dos dados para baixar o PDF). Escrita: só admin da empresa (ou super admin).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.client_company_profiles (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  logo_url text,
  address_line1 text,
  address_line2 text,
  phone text,
  email text,
  website text,
  notes text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_company_profiles_name_len check (char_length(btrim(name)) between 1 and 120),
  constraint client_company_profiles_logo_https check (logo_url is null or logo_url ~ '^https://')
);
create unique index if not exists client_company_profiles_org_name_uq on public.client_company_profiles (org_id, lower(btrim(name)));

alter table public.client_company_profiles enable row level security;
drop policy if exists client_company_profiles_select on public.client_company_profiles;
create policy client_company_profiles_select on public.client_company_profiles
  for select using (public.is_org_member(org_id));
drop policy if exists client_company_profiles_write on public.client_company_profiles;
create policy client_company_profiles_write on public.client_company_profiles
  for all using (public.is_org_admin() and public.is_org_member(org_id))
  with check (public.is_org_admin() and public.is_org_member(org_id));

drop trigger if exists client_company_profiles_updated_at on public.client_company_profiles;
create trigger client_company_profiles_updated_at before update on public.client_company_profiles
  for each row execute function public.update_updated_at();
