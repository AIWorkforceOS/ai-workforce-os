-- ============================================================
-- Migration 111 — Carrossel no Gestor de Conteúdo
--
-- Só aditiva. `format` distingue post de imagem única (todo o histórico, default) de carrossel; `carousel` guarda o
-- conteúdo editável (capa, slides, CTA, hashtags) e as URLs dos slides já desenhados. A capa continua em image_url,
-- então toda tela/rotina que já lê image_url segue funcionando.
-- ============================================================
alter table public.content_posts
  add column if not exists format text not null default 'image' check (format in ('image', 'carousel')),
  add column if not exists carousel jsonb;
