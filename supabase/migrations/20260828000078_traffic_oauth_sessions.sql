-- Login com Facebook pro Tráfego Pago (pedido do Vinicius, 2026-08-28):
-- mesmo modelo do content_oauth_sessions (migration 070), só que pra conta
-- de anúncio em vez de Página. Diferença: GET /me/adaccounts não devolve
-- um token por conta (diferente de /me/accounts pra Páginas) — o mesmo
-- token de usuário de longa duração acessa qualquer conta candidata, por
-- isso ele fica guardado uma vez só na sessão (access_token), não dentro
-- de cada item de `accounts`.
create table if not exists traffic_oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  access_token text not null,
  -- [{id, name, currency, account_status}]
  accounts jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists traffic_oauth_sessions_unit_idx on traffic_oauth_sessions(unit_id);

alter table traffic_oauth_sessions enable row level security;

drop policy if exists traffic_oauth_sessions_select on traffic_oauth_sessions;
create policy traffic_oauth_sessions_select on traffic_oauth_sessions
  for select using (public.can_access_unit(unit_id) and public.is_org_admin());

drop policy if exists traffic_oauth_sessions_write on traffic_oauth_sessions;
create policy traffic_oauth_sessions_write on traffic_oauth_sessions
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());
