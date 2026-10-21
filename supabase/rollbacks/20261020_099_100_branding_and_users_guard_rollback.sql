-- Rollback das migrations 099 (trava de colunas privilegiadas em public.users) e 100 (marca da empresa). Rodar SOMENTE com autorização.
-- ATENÇÃO: remover as colunas de marca apaga as logos e as permissões já concedidas (as imagens no bucket "org-branding" ficam e podem ser apagadas à parte).
-- Reverter a 099 REABRE a falha em que um usuário comum pode alterar o próprio papel/empresa — só faça se houver substituta aplicada.

-- 100
alter table public.users drop column if exists can_manage_branding;
alter table public.organizations drop column if exists brand_logo_url;
alter table public.organizations drop column if exists brand_logo_updated_at;
alter table public.organizations drop column if exists brand_logo_updated_by;
-- (opcional) esvaziar e remover o bucket pelo painel/API do Storage: delete from storage.buckets exige o bucket vazio.

-- 099
drop trigger if exists users_guard_privileged_columns on public.users;
drop function if exists public.users_guard_privileged_columns();
