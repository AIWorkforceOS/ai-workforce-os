-- Migration 100 — Marca da empresa (Fase 1 do plano Mawi). ADITIVA; NÃO aplicada até autorização.
-- Logo por organização + permissão POR USUÁRIO (concedida só pelo super admin Alizo) para a empresa trocar a própria logo.
-- Depende da 099: o gatilho de lá impede qualquer usuário comum de conceder a si mesmo a permissão (can_manage_branding).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.organizations add column if not exists brand_logo_url text;
alter table public.organizations add column if not exists brand_logo_updated_at timestamptz;
alter table public.organizations add column if not exists brand_logo_updated_by uuid;
alter table public.users add column if not exists can_manage_branding boolean not null default false;
comment on column public.users.can_manage_branding is 'Admin autorizado pelo super admin Alizo a trocar a logo da própria empresa. Só o super admin (ou o servidor) altera.';

-- Armazenamento: leitura pública (a logo aparece nos painéis, e-mails e PDFs); escrita SOMENTE pelo servidor (sem política de escrita para usuários).
-- O servidor valida e normaliza a imagem antes de gravar (PNG/JPEG/WebP, até 2 MB; SVG não é aceito).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-branding', 'org-branding', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
