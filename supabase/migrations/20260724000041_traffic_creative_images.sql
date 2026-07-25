-- ============================================================
-- AI Workforce OS — Migration 41: Imagem de criativo no Tráfego Pago
--
-- Retrofit do funcionário "Gestor de Tráfego Pago": até aqui ele só
-- gerava TEXTO de anúncio (headline/body) via lib/traffic/launcher.ts —
-- a campanha nascia PAUSED sem imagem, dependendo do cliente subir uma.
-- Esta migration adiciona a fila de aprovação de criativo (texto que o
-- chamador já monta + imagem gerada por IA) que precede o lançamento
-- real da campanha nas plataformas.
--
-- campaign_creative_drafts — um rascunho por tentativa de criação de
--   campanha: guarda a especificação completa (spec jsonb, o mesmo
--   contrato de NewCampaignSpec) e a imagem gerada, aguardando aprovação
--   humana antes de launchCampaign() ser chamado de verdade. Só depois
--   de 'approved' a campanha nasce PAUSED nas plataformas (mesma trava
--   de segurança que já existia para o texto).
--
-- Reaproveita a IMAGEM gerada por gpt-image-1 (mesma OPENAI_API_KEY, ver
-- lib/traffic/creative-image.ts que chama lib/openai.ts:generateImage —
-- o mesmo motor do funcionário Conteúdo/Social).
--
-- Storage: reaproveita o bucket 'content-media' (migration 040) em vez de
-- criar um bucket novo — mesma natureza de arquivo (imagem gerada por IA,
-- pública, particionada por unit_id), e a política de storage já usa
-- (storage.foldername(name))[1]::uuid = unit_id, então imagens do
-- Tráfego só precisam de um subcaminho próprio dentro do mesmo bucket
-- (unit_id/traffic/...) — nenhuma policy nova é necessária. Criar um
-- bucket 'traffic-media' só duplicaria a mesma política de leitura
-- pública + escrita por can_access_unit sem ganho nenhum.
--
-- RLS: mesma receita das migrations 030/036/040 — leitura com
-- can_access_unit(unit_id); decisão humana (aprovar/rejeitar) exige
-- can_access_unit + is_org_admin(); criação do rascunho (com a imagem
-- gerada) é do motor (service role/is_super_admin), espelhando
-- content_posts_insert.
-- ============================================================

create table if not exists campaign_creative_drafts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  ad_account_id uuid not null references ad_accounts(id) on delete cascade,
  platform text not null,                        -- 'meta' | 'google'
  -- Especificação completa da campanha a lançar (NewCampaignSpec) — o
  -- creative.imageUrl só é preenchido no spec efetivamente lançado após
  -- aprovação (ver rota PATCH); aqui fica o spec "base" (sem imagem).
  spec jsonb not null,
  -- false quando a plataforma/canal não usa imagem nesta rodada (Google
  -- Search — só Responsive Search Ad, texto puro; ver google-ads.ts) —
  -- o rascunho ainda existe para aprovar o texto, só não tenta gerar imagem.
  image_applicable boolean not null default true,
  image_prompt text,                              -- prompt (em inglês) usado no gpt-image-1, auditável
  image_url text,                                 -- Supabase Storage (bucket content-media), URL pública
  status text not null default 'pending_approval',
    -- pending_approval | approved | rejected | launched | launch_failed
  decided_by text,                                -- e-mail do humano que aprovou/rejeitou
  launch_result jsonb,                             -- CampaignLaunchOutcome após a tentativa real de lançamento
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campaign_creative_drafts_unit_idx
  on campaign_creative_drafts(unit_id, created_at desc);
create index if not exists campaign_creative_drafts_account_idx
  on campaign_creative_drafts(ad_account_id, created_at desc);
create index if not exists campaign_creative_drafts_status_idx
  on campaign_creative_drafts(status) where status = 'pending_approval';

create trigger campaign_creative_drafts_updated_at before update on campaign_creative_drafts
  for each row execute function update_updated_at();

alter table campaign_creative_drafts enable row level security;

drop policy if exists campaign_creative_drafts_select on campaign_creative_drafts;
create policy campaign_creative_drafts_select on campaign_creative_drafts
  for select using (public.can_access_unit(unit_id));

-- Humano aprova/rejeita (update); criação do rascunho é do motor (service role).
drop policy if exists campaign_creative_drafts_update on campaign_creative_drafts;
create policy campaign_creative_drafts_update on campaign_creative_drafts
  for update using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

drop policy if exists campaign_creative_drafts_insert on campaign_creative_drafts;
create policy campaign_creative_drafts_insert on campaign_creative_drafts
  for insert with check (public.is_super_admin());

drop policy if exists campaign_creative_drafts_delete on campaign_creative_drafts;
create policy campaign_creative_drafts_delete on campaign_creative_drafts
  for delete using (public.is_super_admin());
