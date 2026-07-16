-- ============================================================
-- AI Workforce OS — Migration 15: e-mail como canal adicional de
-- prospecção/acompanhamento do Sales Rep + logo da unidade
--
-- O Sales Rep passa a poder falar com o lead por e-mail em paralelo ao
-- WhatsApp/SMS (lib/channels/messaging-channel.ts → EmailChannel),
-- usando o mesmo motor de conversa. `leads.email` e
-- `conversations.channel = 'email'` já existiam desde a migration
-- inicial (a coluna `channel` nunca teve CHECK constraint), então o
-- único schema novo aqui é a logo da unidade, usada para montar o
-- template de e-mail com a marca do cliente.
-- ============================================================

alter table units
  add column if not exists logo_url text;

comment on column units.logo_url is
  'URL pública da logo da unidade (Supabase Storage, bucket unit-logos), usada no template de e-mail do Sales Rep e em outros pontos com a marca do cliente.';

-- ------------------------------------------------------------
-- STORAGE: bucket público para logos das unidades
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('unit-logos', 'unit-logos', true)
on conflict (id) do nothing;

-- Caminho dos arquivos: {unit_id}/{filename} — a política de escrita usa
-- o primeiro segmento do path para checar acesso via can_access_unit(),
-- mesma função usada no resto do RLS multi-tenant (migration 5).
drop policy if exists unit_logos_public_read on storage.objects;
create policy unit_logos_public_read on storage.objects
  for select using (bucket_id = 'unit-logos');

drop policy if exists unit_logos_write on storage.objects;
create policy unit_logos_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'unit-logos'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
  );

drop policy if exists unit_logos_update on storage.objects;
create policy unit_logos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'unit-logos'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
  );

drop policy if exists unit_logos_delete on storage.objects;
create policy unit_logos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'unit-logos'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
  );
