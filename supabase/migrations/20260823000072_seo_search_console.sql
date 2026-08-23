-- ============================================================
-- AI Workforce OS — Migration 72: SEO — Google Search Console (dados reais)
--
-- Pedido do Vinicius (2026-08-23): o funcionário de SEO precisa "de fato
-- trabalhar, buscar resultados" — até aqui (migration 042) ele auditava o
-- site (real) e gerava conteúdo (real, mas só rascunho), mas não tinha
-- NENHUMA fonte de dado real de desempenho de busca (cliques, impressões,
-- posição média) — o rank tracking via SerpApi existe em código mas
-- depende de SERP_API_KEY (paga, nunca configurada).
--
-- Google Search Console é a fonte OFICIAL e gratuita desse dado (vem do
-- próprio Google, não de scraping de terceiro) — por isso entra antes do
-- SerpApi na prioridade. Exige OAuth (o cliente loga com a conta Google
-- que já tem a propriedade verificada no Search Console e autoriza leitura
-- — GOOGLE_SEARCH_CONSOLE_CLIENT_ID/SECRET, ver
-- docs/setup/seo-search-console-setup.md), mesmo padrão de fluxo do login
-- com Facebook do Conteúdo (migration 070/content/meta-oauth.ts):
-- signOAuthState/verifyOAuthState são reaproveitados diretamente (função
-- pura, agnóstica de provedor).
--
--   seo_gsc_oauth_sessions      — sessão temporária (poucos minutos) só
--     para o caso raro de a conta Google ter mais de uma propriedade
--     verificada — cliente escolhe qual conectar. Mesmo raciocínio de
--     content_oauth_sessions (migration 070).
--   seo_search_console_accounts — conexão permanente (1 por unidade):
--     propriedade escolhida + tokens. RLS igual social_accounts (migration
--     040): escrita humana direta via can_access_unit()+is_org_admin(),
--     porque o callback do OAuth roda com a sessão do próprio usuário (não
--     service role) — mesmo padrão do login com Facebook.
--   seo_search_console_snapshots — histórico (motor grava, cadência
--     semanal no cron): cliques/impressões/CTR/posição média dos últimos
--     28 dias + top palavras-chave reais. RLS igual seo_keyword_rankings:
--     só o motor (service role) insere.
-- ============================================================

-- ------------------------------------------------------------
-- TABELA: seo_gsc_oauth_sessions — escolha de propriedade (quando > 1)
-- ------------------------------------------------------------
create table if not exists seo_gsc_oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  site_urls jsonb not null,              -- string[] das propriedades verificadas nessa conta Google
  -- o refresh/access token são da CONTA Google autenticada, não de uma
  -- propriedade específica — servem pra qualquer site_url da lista acima.
  -- Nunca no repo, só aqui (mesmo aviso de social_accounts.page_access_token).
  refresh_token text not null,
  access_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists seo_gsc_oauth_sessions_unit_idx on seo_gsc_oauth_sessions(unit_id);

alter table seo_gsc_oauth_sessions enable row level security;

drop policy if exists seo_gsc_oauth_sessions_select on seo_gsc_oauth_sessions;
create policy seo_gsc_oauth_sessions_select on seo_gsc_oauth_sessions
  for select using (public.can_access_unit(unit_id) and public.is_org_admin());

drop policy if exists seo_gsc_oauth_sessions_write on seo_gsc_oauth_sessions;
create policy seo_gsc_oauth_sessions_write on seo_gsc_oauth_sessions
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

-- ------------------------------------------------------------
-- TABELA: seo_search_console_accounts — conexão permanente (1 por unidade)
-- ------------------------------------------------------------
create table if not exists seo_search_console_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  site_url text not null,                -- propriedade do Search Console escolhida (ex: "https://exemplo.com/" ou "sc-domain:exemplo.com")
  refresh_token text not null,
  access_token text,
  token_expires_at timestamptz,
  connection_status text not null default 'connected',  -- connected | error | disconnected
  connection_error text,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id)
);

create index if not exists seo_search_console_accounts_org_idx on seo_search_console_accounts(org_id);

create trigger seo_search_console_accounts_updated_at before update on seo_search_console_accounts
  for each row execute function update_updated_at();

alter table seo_search_console_accounts enable row level security;

drop policy if exists seo_search_console_accounts_select on seo_search_console_accounts;
create policy seo_search_console_accounts_select on seo_search_console_accounts
  for select using (public.can_access_unit(unit_id));

-- Escrita humana direta (via rota OAuth, sessão do próprio usuário) — mesmo
-- padrão de social_accounts; o cron só faz UPDATE de token/status (também
-- coberto por esta policy, roda com service role que ignora RLS de qualquer forma).
drop policy if exists seo_search_console_accounts_write on seo_search_console_accounts;
create policy seo_search_console_accounts_write on seo_search_console_accounts
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

-- ------------------------------------------------------------
-- TABELA: seo_search_console_snapshots — histórico de desempenho real
-- ------------------------------------------------------------
create table if not exists seo_search_console_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  total_clicks int not null default 0,
  total_impressions int not null default 0,
  avg_ctr numeric not null default 0,
  avg_position numeric not null default 0,
  top_queries jsonb not null default '[]'::jsonb,  -- [{query, clicks, impressions, ctr, position}], até 20, ordenado por cliques desc
  created_at timestamptz not null default now()
);

create index if not exists seo_search_console_snapshots_unit_idx
  on seo_search_console_snapshots(unit_id, created_at desc);

alter table seo_search_console_snapshots enable row level security;

drop policy if exists seo_search_console_snapshots_select on seo_search_console_snapshots;
create policy seo_search_console_snapshots_select on seo_search_console_snapshots
  for select using (public.can_access_unit(unit_id));

drop policy if exists seo_search_console_snapshots_insert on seo_search_console_snapshots;
create policy seo_search_console_snapshots_insert on seo_search_console_snapshots
  for insert with check (public.is_super_admin());

drop policy if exists seo_search_console_snapshots_delete on seo_search_console_snapshots;
create policy seo_search_console_snapshots_delete on seo_search_console_snapshots
  for delete using (public.is_super_admin());
