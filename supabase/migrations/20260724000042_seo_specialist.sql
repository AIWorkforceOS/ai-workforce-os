-- ============================================================
-- AI Workforce OS — Migration 42: SEO (Digital Employee)
--
-- Terceiro e último funcionário do time de marketing (depois de
-- Conteúdo/Social, migration 040, e do retrofit de imagem do Tráfego,
-- migration 041). Expectativa alinhada com o cliente: nenhuma IA "coloca
-- a empresa no topo do Google" de verdade — o que este funcionário faz:
--
--   seo_audits              — auditoria técnica REAL do site (fetch +
--     parsing: title/meta description/h1-h2/alt/viewport/canonical/
--     JSON-LD/HTTPS/sitemap.xml/robots.txt), nota 0-100 + lista de
--     problemas com recomendação específica por item.
--   seo_content_items        — fila de conteúdo otimizado (blog/landing
--     page) E também os textos de Google Business Profile (descrição do
--     negócio, posts de atualização) — mesma fila/UX de aprovação de
--     content_posts (migration 040), tabela IRMÃ (não a mesma) porque o
--     formato é bem diferente: post de blog é markdown longo com
--     título/meta description, GBP não tem plataforma de publicação real
--     nenhuma (o cliente cola manualmente) — nenhum dos dois tem
--     external_post_id/published_at porque não há publicação automática
--     aqui, ao contrário do Conteúdo/Social.
--   seo_gbp_checklist_state — só o estado (feito/não feito) de um
--     checklist ESTÁTICO (catálogo em código, lib/seo/gbp-checklist.ts,
--     sem tabela própria) — o cliente marca o que já fez manualmente no
--     Google Business Profile; sem integração/API real (Alizo só tem
--     GOOGLE_MAPS_API_KEY, que é Places API, não serve para isso).
--   seo_keywords / seo_keyword_rankings — acompanhamento de posição de
--     palavra-chave: schema pronto, mas a consulta real de posição
--     depende de SERP_API_KEY (nenhuma API de rank tracking configurada
--     no projeto hoje) — sem a env var, lib/seo/rank-tracking.ts falha
--     de forma graciosa (mesmo padrão de toda integração externa do
--     projeto, ver CLAUDE.md) e simplesmente não gera linha de histórico;
--     o resto do funcionário (auditoria + conteúdo + GBP) funciona 100%
--     sem essa chave.
--
-- agent_configs: sem mudança de schema — agent_type = 'seo_specialist'
-- (coluna text já existente). Diferente de Tráfego/Conteúdo, este
-- funcionário não tem um passo de "conectar conta" — a URL do site, as
-- palavras-chave alvo, concorrentes e região vêm da própria entrevista de
-- contratação (agent_configs.business_profile.site_url etc., ver
-- lib/interview/engine.ts) e alimentam diretamente o motor de auditoria.
--
-- Storage: reaproveita o bucket 'content-media' (migration 040) para as
-- imagens de blog/GBP geradas por IA, path {unit_id}/seo/... — mesmo
-- raciocínio da migration 041 (nenhuma policy nova necessária, a
-- política já usa (storage.foldername(name))[1]::uuid = unit_id).
--
-- RLS: mesma receita das migrations 030/036/040/041 — leitura com
-- can_access_unit(unit_id); conteúdo GERADO PELO MOTOR (seo_audits,
-- seo_content_items) só é inserido por service role (is_super_admin()),
-- decisão humana (aprovar/rejeitar/editar item, rodar auditoria) passa
-- pelo update/rota; já seo_gbp_checklist_state e seo_keywords são dados
-- do PRÓPRIO usuário (ele marca o checklist e escolhe quais palavras-chave
-- acompanhar) — permitem insert/update/delete direto por
-- can_access_unit()+is_org_admin(), sem passar por rota/service role,
-- mesmo padrão de agent_configs (ver ActivateForm em employee-catalog.tsx).
-- ============================================================

-- ------------------------------------------------------------
-- TABELA: seo_audits — auditoria técnica real do site
-- ------------------------------------------------------------
create table if not exists seo_audits (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  site_url text not null,
  score int not null default 0,               -- 0-100, ver lib/seo/audit.ts:computeSeoScore
  checks jsonb not null default '[]'::jsonb,  -- SeoCheck[]: {id,label,status,message,recommendation}
  error_message text,                          -- preenchido quando o site não respondeu (auditoria ainda é gravada, com checks=[])
  created_at timestamptz not null default now()
);

create index if not exists seo_audits_unit_idx on seo_audits(unit_id, created_at desc);

alter table seo_audits enable row level security;

drop policy if exists seo_audits_select on seo_audits;
create policy seo_audits_select on seo_audits
  for select using (public.can_access_unit(unit_id));

-- Criação é do motor (cron ou rota /api/seo/units/[unitId]/audits/run,
-- ambas via service role) — nunca direto pelo usuário, porque a rota
-- precisa controlar QUAL url é buscada (sempre a cadastrada na
-- entrevista) para não virar um proxy de fetch de URL arbitrária.
drop policy if exists seo_audits_insert on seo_audits;
create policy seo_audits_insert on seo_audits
  for insert with check (public.is_super_admin());

drop policy if exists seo_audits_delete on seo_audits;
create policy seo_audits_delete on seo_audits
  for delete using (public.is_super_admin());

-- ------------------------------------------------------------
-- TABELA: seo_content_items — fila de conteúdo (blog/landing) + GBP
-- ------------------------------------------------------------
create table if not exists seo_content_items (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  content_type text not null,                  -- 'blog' | 'landing_page' | 'gbp_description' | 'gbp_post'
  status text not null default 'pending_approval',
    -- pending_approval | approved | rejected  (sem 'published' — não há publicação automática nesta fase)
  target_keyword text,                          -- palavra-chave que este item mira (null para gbp_description)
  title text not null default '',
  meta_description text,                        -- só relevante para blog/landing_page
  body_markdown text not null default '',
  image_prompt text,
  image_url text,                                -- Supabase Storage (bucket content-media), URL pública
  reasoning text not null default '',
  decided_by text,                               -- e-mail do humano que aprovou/rejeitou/editou
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists seo_content_items_unit_idx on seo_content_items(unit_id, created_at desc);
create index if not exists seo_content_items_status_idx
  on seo_content_items(status) where status = 'pending_approval';

create trigger seo_content_items_updated_at before update on seo_content_items
  for each row execute function update_updated_at();

alter table seo_content_items enable row level security;

drop policy if exists seo_content_items_select on seo_content_items;
create policy seo_content_items_select on seo_content_items
  for select using (public.can_access_unit(unit_id));

-- Humano aprova/rejeita/edita (update) direto, sem rota própria — não há
-- efeito colateral externo (nenhuma publicação automática), só troca de
-- status/texto; criação é do motor (service role).
drop policy if exists seo_content_items_update on seo_content_items;
create policy seo_content_items_update on seo_content_items
  for update using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

drop policy if exists seo_content_items_insert on seo_content_items;
create policy seo_content_items_insert on seo_content_items
  for insert with check (public.is_super_admin());

drop policy if exists seo_content_items_delete on seo_content_items;
create policy seo_content_items_delete on seo_content_items
  for delete using (public.is_super_admin());

-- ------------------------------------------------------------
-- TABELA: seo_gbp_checklist_state — estado do checklist de GBP
--
-- O catálogo dos itens (rótulo/descrição) é ESTÁTICO, em código
-- (lib/seo/gbp-checklist.ts) — aqui só fica o "feito/não feito" que o
-- próprio cliente marca, por unidade.
-- ------------------------------------------------------------
create table if not exists seo_gbp_checklist_state (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  item_key text not null,
  is_done boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (unit_id, item_key)
);

create index if not exists seo_gbp_checklist_state_unit_idx on seo_gbp_checklist_state(unit_id);

create trigger seo_gbp_checklist_state_updated_at before update on seo_gbp_checklist_state
  for each row execute function update_updated_at();

alter table seo_gbp_checklist_state enable row level security;

drop policy if exists seo_gbp_checklist_state_select on seo_gbp_checklist_state;
create policy seo_gbp_checklist_state_select on seo_gbp_checklist_state
  for select using (public.can_access_unit(unit_id));

-- Dado do PRÓPRIO usuário (ele marca o que já fez) — escreve direto,
-- diferente de seo_audits/seo_content_items (gerados pelo motor).
drop policy if exists seo_gbp_checklist_state_write on seo_gbp_checklist_state;
create policy seo_gbp_checklist_state_write on seo_gbp_checklist_state
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

-- ------------------------------------------------------------
-- TABELA: seo_keywords — palavras-chave acompanhadas (rank tracking)
-- ------------------------------------------------------------
create table if not exists seo_keywords (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  keyword text not null,
  target_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, keyword)
);

create index if not exists seo_keywords_unit_idx on seo_keywords(unit_id);

create trigger seo_keywords_updated_at before update on seo_keywords
  for each row execute function update_updated_at();

alter table seo_keywords enable row level security;

drop policy if exists seo_keywords_select on seo_keywords;
create policy seo_keywords_select on seo_keywords
  for select using (public.can_access_unit(unit_id));

-- Lista que o próprio cliente escolhe acompanhar — CRUD direto, mesmo
-- raciocínio de seo_gbp_checklist_state.
drop policy if exists seo_keywords_write on seo_keywords;
create policy seo_keywords_write on seo_keywords
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

-- ------------------------------------------------------------
-- TABELA: seo_keyword_rankings — histórico de posição (motor)
--
-- unit_id/org_id denormalizados (não só keyword_id) para a policy de RLS
-- poder checar can_access_unit sem join — mesmo padrão de content_posts
-- (que denormaliza unit_id apesar de já ter social_account_id).
-- ------------------------------------------------------------
create table if not exists seo_keyword_rankings (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  keyword_id uuid not null references seo_keywords(id) on delete cascade,
  position int,                                 -- null = não encontrado nos resultados/consulta falhou
  checked_at timestamptz not null default now()
);

create index if not exists seo_keyword_rankings_keyword_idx
  on seo_keyword_rankings(keyword_id, checked_at desc);
create index if not exists seo_keyword_rankings_unit_idx on seo_keyword_rankings(unit_id);

alter table seo_keyword_rankings enable row level security;

drop policy if exists seo_keyword_rankings_select on seo_keyword_rankings;
create policy seo_keyword_rankings_select on seo_keyword_rankings
  for select using (public.can_access_unit(unit_id));

-- Só o motor grava histórico de posição (cron, quando SERP_API_KEY
-- estiver configurada).
drop policy if exists seo_keyword_rankings_insert on seo_keyword_rankings;
create policy seo_keyword_rankings_insert on seo_keyword_rankings
  for insert with check (public.is_super_admin());

drop policy if exists seo_keyword_rankings_delete on seo_keyword_rankings;
create policy seo_keyword_rankings_delete on seo_keyword_rankings
  for delete using (public.is_super_admin());
