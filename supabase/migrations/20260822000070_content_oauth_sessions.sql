-- Login com Facebook pro Gestor de Conteúdo (pedido do Vinicius, 2026-08-22):
-- em vez de o cliente colar o ID da Página / compartilhar como Parceiro do
-- Business Manager (mais técnico), ele clica "Conectar com Facebook", loga
-- na própria conta e escolhe a Página numa lista.
--
-- content_oauth_sessions guarda, por poucos minutos, as Páginas que a conta
-- do Facebook do cliente administra (id/nome/token de cada uma) — só existe
-- pro caso de o cliente administrar mais de uma Página, quando precisamos
-- de uma etapa a mais (escolher qual) entre o callback do OAuth e o
-- INSERT/UPDATE final em social_accounts. Sessão de uso único, expira
-- rápido (ver META_OAUTH_SESSION_TTL_MINUTES em lib/content/meta-oauth.ts);
-- apagada assim que a escolha é finalizada.
create table if not exists content_oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  -- [{id, name, access_token, instagram_business_account_id, instagram_username}]
  -- mesmo aviso de social_accounts.page_access_token: nunca no repo, só aqui.
  pages jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists content_oauth_sessions_unit_idx on content_oauth_sessions(unit_id);

alter table content_oauth_sessions enable row level security;

drop policy if exists content_oauth_sessions_select on content_oauth_sessions;
create policy content_oauth_sessions_select on content_oauth_sessions
  for select using (public.can_access_unit(unit_id) and public.is_org_admin());

drop policy if exists content_oauth_sessions_write on content_oauth_sessions;
create policy content_oauth_sessions_write on content_oauth_sessions
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());
