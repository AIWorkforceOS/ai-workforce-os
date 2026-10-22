drop policy if exists lead_attachments_storage_comercial_own on storage.objects;
drop policy if exists conversations_comercial_own on public.conversations;
drop policy if exists lead_attachments_comercial_own on public.lead_attachments;
drop policy if exists lead_activities_comercial_own on public.lead_activities;
drop policy if exists leads_comercial_own on public.leads;
drop function if exists public.current_app_user_id();
