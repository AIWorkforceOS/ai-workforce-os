-- Só desfaz se não existir post de vídeo (senão a constraint antiga falha de propósito).
alter table public.content_posts drop column if exists video;
alter table public.content_posts drop constraint if exists content_posts_format_check;
alter table public.content_posts add constraint content_posts_format_check check (format in ('image', 'carousel'));
