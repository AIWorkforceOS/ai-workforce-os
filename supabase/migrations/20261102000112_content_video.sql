-- ============================================================
-- Migration 112 — Vídeo curto vertical (9:16) no Gestor de Conteúdo
--
-- Só aditiva. Amplia o `format` criado na 111 ('image' | 'carousel') com 'video' e guarda o roteiro/cenas e o MP4 renderizado em `video` (jsonb).
-- A capa do vídeo (primeiro quadro) continua em image_url, então toda tela que já lê image_url segue funcionando.
-- ============================================================
alter table public.content_posts drop constraint if exists content_posts_format_check;
alter table public.content_posts
  add constraint content_posts_format_check check (format in ('image', 'carousel', 'video')),
  add column if not exists video jsonb;
