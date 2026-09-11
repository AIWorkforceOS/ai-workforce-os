-- Integração com a Facil-IT/360 (tech.facilit.fm), pedido do Vinicius
-- 2026-09-10, para a org "Mawi Pro" (login vinny29lp@gmail.com — distinta
-- da "Mawi Cleaning" já existente, que é só limpeza).
--
-- A Facil-IT não tem API pública documentada — a integração usa a API
-- interna do app mobile deles (engenharia reversa autorizada pelo dono,
-- feita observando a sessão já autenticada do próprio usuário, nunca a
-- senha em si). Duas tabelas:
--
-- facilit_credentials: Client Code/Login/Password da Facil-IT por unidade,
-- guardados em texto puro (mesmo padrão já usado no projeto pra segredos de
-- terceiro — ex.: units.evolution_api_key, social_accounts.page_access_token
-- — protegido por RLS + só acessado server-side). Sem isso não dá pra fazer
-- login sozinho no cron; a alternativa de guardar só o token de sessão foi
-- descartada de propósito porque ele pode expirar/ser revogado sem aviso, e
-- o pedido explícito foi "depois de logado e conectado, não pode cair" —
-- login novo a cada sync resolve isso sem precisar de lógica de renovação.
--
-- facilit_work_orders: cache local das ordens importadas (hoje + amanhã),
-- com atribuição de técnico (assigned_employee_id) feita pelo cliente
-- dentro do Alizo — não mexe no motor de agenda/appointments existente,
-- é só uma fila de triagem "chegou da Facil-IT → mandei pro fulano".

create table if not exists facilit_credentials (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  client_code text not null,
  username text not null,
  password text not null,
  is_active boolean not null default true,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id)
);

create index if not exists facilit_credentials_org_idx on facilit_credentials(org_id);

create trigger facilit_credentials_updated_at before update on facilit_credentials
  for each row execute function update_updated_at();

alter table facilit_credentials enable row level security;

drop policy if exists facilit_credentials_select on facilit_credentials;
create policy facilit_credentials_select on facilit_credentials
  for select using (public.can_access_unit(unit_id) and public.is_org_admin());

drop policy if exists facilit_credentials_write on facilit_credentials;
create policy facilit_credentials_write on facilit_credentials
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

create table if not exists facilit_work_orders (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  facilit_order_number text not null,
  po_number text,
  client_po text,
  company text,
  address1 text,
  address2 text,
  city text,
  state text,
  zip text,
  phone text,
  category text,
  order_type text,
  priority text,
  status text,
  requested_at timestamptz,
  visit_date timestamptz,
  latitude double precision,
  longitude double precision,
  scope text,
  raw jsonb not null default '{}',
  assigned_employee_id uuid references employees(id) on delete set null,
  assigned_at timestamptz,
  assigned_by uuid references users(id) on delete set null,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, facilit_order_number)
);

create index if not exists facilit_work_orders_unit_idx on facilit_work_orders(unit_id);
create index if not exists facilit_work_orders_org_idx on facilit_work_orders(org_id);
create index if not exists facilit_work_orders_visit_date_idx on facilit_work_orders(visit_date);

create trigger facilit_work_orders_updated_at before update on facilit_work_orders
  for each row execute function update_updated_at();

alter table facilit_work_orders enable row level security;

drop policy if exists facilit_work_orders_select on facilit_work_orders;
create policy facilit_work_orders_select on facilit_work_orders
  for select using (public.can_access_unit(unit_id));

drop policy if exists facilit_work_orders_write on facilit_work_orders;
create policy facilit_work_orders_write on facilit_work_orders
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());
