drop policy if exists lead_attachments_storage_delete on storage.objects;
drop policy if exists lead_attachments_storage_insert on storage.objects;
drop policy if exists lead_attachments_storage_select on storage.objects;
drop table if exists public.lead_attachments;
-- o bucket só pode ser removido depois de esvaziado (Storage > lead-attachments): delete from storage.buckets where id = 'lead-attachments';
