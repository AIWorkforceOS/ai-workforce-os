-- ============================================================
-- AI Workforce OS — Migration 40: Conteúdo/Social (Digital Employee)
--
-- Novo funcionário digital de conteúdo orgânico (Instagram + Facebook):
--   social_accounts — Página do Facebook conectada (+ conta Business do
--     Instagram vinculada, descoberta automaticamente) por unidade.
--   content_posts    — fila/calendário de posts gerados (legenda + imagem
--     por IA), com status de rascunho até publicado.
--
-- Desenho de conexão: TABELA PRÓPRIA (não reaproveita ad_accounts).
-- ad_accounts guarda credenciais de ANÚNCIO (external_account_id = conta
-- de anúncio, escopo ads_management) — publicar conteúdo orgânico exige
-- escopos totalmente diferentes (pages_manage_posts, pages_read_engagement,
-- instagram_basic, instagram_content_publish) sobre um objeto diferente
-- (Página do Facebook, não conta de anúncio). Misturar os dois na mesma
-- tabela obrigaria campos nulos cruzados (page_id vs external_account_id)
-- e checagens condicionais espalhadas pelo código do Tráfego — mais risco
-- de regressão no que já está em produção do que uma tabela nova.
--
-- Conexão continua manual (token colado), mesmo padrão de ad_accounts: o
-- cliente cola o Page ID + um token de página de longa duração (gerado no
-- Meta Business Suite/Graph API Explorer com os escopos acima) e o backend
-- testa de verdade (GET /{page-id}?fields=...) antes de gravar. A conta
-- Business do Instagram vinculada à Página é descoberta automaticamente
-- (campo instagram_business_account no GET da própria Página) — o cliente
-- não precisa saber o ID dela.
--
-- agent_configs: sem mudança de schema — agent_type = 'content_specialist'
-- (coluna text já existente). Modo autônomo×fila de aprovação vive por
-- conta em social_accounts.publishing_mode, mesmo princípio de
-- ad_accounts.optimization_mode.
--
-- RLS: mesma receita das migrations 007/013/024/026/030/036 — leitura com
-- can_access_unit(unit_id); escrita humana com can_access_unit +
-- is_org_admin(); criação de posts é do motor (service role/cron).
-- ============================================================

-- ------------------------------------------------------------
-- TABELA: social_accounts — Página do Facebook (+ IG vinculado)
-- ------------------------------------------------------------
create table if not exists social_accounts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  platform text not null default 'meta',        -- por ora só 'meta' (Página FB cobre FB + IG vinculado)
  page_id text not null,
  page_name text not null,
  -- Token de página de longa duração (pages_manage_posts, pages_read_engagement,
  -- instagram_basic, instagram_content_publish). Nunca no repo.
  page_access_token text,
  instagram_business_account_id text,           -- descoberto via GET /{page-id}?fields=instagram_business_account
  instagram_username text,
  connection_status text not null default 'pending_credentials',
    -- pending_credentials | connected | error | disconnected
  connection_error text,
  -- 'suggestion' = motor gera e deixa pendente, humano aprova (padrão seguro);
  -- 'autonomous' = motor publica direto (ativação consciente pelo cliente).
  publishing_mode text not null default 'suggestion',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, page_id)
);

create index if not exists social_accounts_unit_idx on social_accounts(unit_id);
create index if not exists social_accounts_org_idx on social_accounts(org_id);

-- ------------------------------------------------------------
-- TABELA: content_posts — fila/calendário de conteúdo
-- ------------------------------------------------------------
create table if not exists content_posts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  social_account_id uuid not null references social_accounts(id) on delete cascade,
  platform text not null,                        -- 'instagram' | 'facebook'
  status text not null default 'draft',
    -- draft | pending_approval | approved | scheduled | published | rejected | failed
  content_pillar text,                           -- tema/pilar do post (aprendido na entrevista), quando aplicável
  caption text not null default '',
  image_prompt text,                             -- prompt usado para gerar a imagem (auditável)
  image_url text,                                -- Supabase Storage (bucket content-media), URL pública
  reasoning text not null default '',             -- por que este post agora (legível por humano)
  mode text not null default 'suggestion',        -- 'suggestion' | 'autonomous' (modo vigente na criação)
  scheduled_for timestamptz,
  published_at timestamptz,
  external_post_id text,                          -- id do post/mídia na plataforma
  error_message text,
  decided_by text,                                -- e-mail do humano que aprovou/rejeitou/editou (null = autônomo)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_posts_account_idx on content_posts(social_account_id, created_at desc);
create index if not exists content_posts_unit_idx on content_posts(unit_id, created_at desc);
create index if not exists content_posts_status_idx
  on content_posts(status) where status in ('pending_approval', 'approved');

-- ------------------------------------------------------------
-- TRIGGERS de updated_at
-- ------------------------------------------------------------
create trigger social_accounts_updated_at before update on social_accounts
  for each row execute function update_updated_at();

create trigger content_posts_updated_at before update on content_posts
  for each row execute function update_updated_at();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table social_accounts enable row level security;

drop policy if exists social_accounts_select on social_accounts;
create policy social_accounts_select on social_accounts
  for select using (public.can_access_unit(unit_id));

drop policy if exists social_accounts_write on social_accounts;
create policy social_accounts_write on social_accounts
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

alter table content_posts enable row level security;

drop policy if exists content_posts_select on content_posts;
create policy content_posts_select on content_posts
  for select using (public.can_access_unit(unit_id));

-- Humanos da org aprovam/rejeitam/editam (update); criação é do motor (service role).
drop policy if exists content_posts_update on content_posts;
create policy content_posts_update on content_posts
  for update using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

drop policy if exists content_posts_insert on content_posts;
create policy content_posts_insert on content_posts
  for insert with check (public.is_super_admin());

drop policy if exists content_posts_delete on content_posts;
create policy content_posts_delete on content_posts
  for delete using (public.is_super_admin());

-- ------------------------------------------------------------
-- STORAGE: bucket público para as imagens geradas por IA
--
-- Público pelo mesmo motivo de unit-logos/employee-attachments: a
-- publicação real no Instagram/Facebook exige que a Graph API busque a
-- imagem por URL (image_url em POST /{ig-user-id}/media e
-- POST /{page-id}/photos), sem o backend da Alizo como intermediário.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('content-media', 'content-media', true)
on conflict (id) do nothing;

-- Caminho dos arquivos: {unit_id}/{filename} — mesmo padrão de
-- unit-logos/employee-attachments: a política usa o primeiro segmento
-- do path com can_access_unit().
drop policy if exists content_media_public_read on storage.objects;
create policy content_media_public_read on storage.objects
  for select using (bucket_id = 'content-media');

drop policy if exists content_media_write_storage on storage.objects;
create policy content_media_write_storage on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'content-media'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
  );

drop policy if exists content_media_update_storage on storage.objects;
create policy content_media_update_storage on storage.objects
  for update to authenticated
  using (
    bucket_id = 'content-media'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
  );

drop policy if exists content_media_delete_storage on storage.objects;
create policy content_media_delete_storage on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'content-media'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
  );
