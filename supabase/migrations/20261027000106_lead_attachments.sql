-- Migration 106 — Anexos no lead (propostas, contratos, prints, planilhas). ADITIVA; NÃO aplicada até autorização.
--  * bucket PRIVADO 'lead-attachments' (15MB, PDF/imagens/Office/CSV/TXT): ninguém abre por link público; o app gera link assinado de 60s.
--  * lead_attachments: um registro por arquivo (quem enviou, nome, tamanho).
-- Acesso (tabela e arquivos): administrador da empresa na unidade; em política restritiva, só administrador completo ou função Comercial
-- (mesmo critério do CRM — migrations 104/105). Técnico e cliente nunca. O primeiro nível do caminho do arquivo é o id da unidade.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lead-attachments', 'lead-attachments', false, 15728640,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do nothing;

create table if not exists public.lead_attachments (
  id uuid primary key default uuid_generate_v4(),
  unit_id uuid not null references public.units(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint lead_attachments_name_len check (char_length(file_name) between 1 and 200)
);
create index if not exists lead_attachments_lead_idx on public.lead_attachments (lead_id, created_at desc);

alter table public.lead_attachments enable row level security;
drop policy if exists lead_attachments_select on public.lead_attachments;
create policy lead_attachments_select on public.lead_attachments
  for select using (public.can_access_unit(unit_id) and public.current_app_role() is distinct from 'employee' and public.current_app_role() is distinct from 'client');
drop policy if exists lead_attachments_write on public.lead_attachments;
create policy lead_attachments_write on public.lead_attachments
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());
drop policy if exists lead_attachments_job_role on public.lead_attachments;
create policy lead_attachments_job_role on public.lead_attachments
  as restrictive for all
  using (public.current_job_role() is null or public.current_job_role() = 'comercial')
  with check (public.current_job_role() is null or public.current_job_role() = 'comercial');

-- Arquivos (storage.objects) do bucket privado
drop policy if exists lead_attachments_storage_select on storage.objects;
create policy lead_attachments_storage_select on storage.objects
  for select to authenticated using (
    bucket_id = 'lead-attachments'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
    and public.current_app_role() is distinct from 'employee' and public.current_app_role() is distinct from 'client'
    and (public.current_job_role() is null or public.current_job_role() = 'comercial')
  );
drop policy if exists lead_attachments_storage_insert on storage.objects;
create policy lead_attachments_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'lead-attachments'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
    and public.is_org_admin()
    and (public.current_job_role() is null or public.current_job_role() = 'comercial')
  );
drop policy if exists lead_attachments_storage_delete on storage.objects;
create policy lead_attachments_storage_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'lead-attachments'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
    and public.is_org_admin()
    and (public.current_job_role() is null or public.current_job_role() = 'comercial')
  );
