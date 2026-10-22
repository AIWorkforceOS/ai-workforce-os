-- Migration 109 — A função Comercial vê só os leads atribuídos a ela. ADITIVA; NÃO aplicada até autorização.
-- Políticas RESTRITIVAS (somam-se às existentes) que só mudam o que quem tem job_role = 'comercial' enxerga e grava. Administrador completo, Financeiro,
-- Operacional e todo o servidor (service role: webhooks, agentes, cron) seguem exatamente como hoje.
--  * leads: o Comercial lê/edita/apaga só os leads em que ele é o responsável (owner_user_id) e só cria leads em nome dele.
--  * lead_activities, lead_attachments, conversations: só as dos leads que ele enxerga (conversa sem lead não aparece para ele).
--  * arquivos do bucket privado lead-attachments: só os de leads dele (a pasta do meio do caminho é o id do lead). O CASE garante que a conversão
--    para uuid só roda nos arquivos desse bucket — nenhum outro bucket é afetado.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.current_app_user_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select u.id
  from public.users u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and u.is_active
  limit 1;
$$;

drop policy if exists leads_comercial_own on public.leads;
create policy leads_comercial_own on public.leads
  as restrictive for all
  using (public.current_job_role() is distinct from 'comercial' or owner_user_id = public.current_app_user_id())
  with check (public.current_job_role() is distinct from 'comercial' or owner_user_id = public.current_app_user_id());

drop policy if exists lead_activities_comercial_own on public.lead_activities;
create policy lead_activities_comercial_own on public.lead_activities
  as restrictive for all
  using (public.current_job_role() is distinct from 'comercial' or exists (select 1 from public.leads l where l.id = lead_activities.lead_id))
  with check (public.current_job_role() is distinct from 'comercial' or exists (select 1 from public.leads l where l.id = lead_activities.lead_id));

drop policy if exists lead_attachments_comercial_own on public.lead_attachments;
create policy lead_attachments_comercial_own on public.lead_attachments
  as restrictive for all
  using (public.current_job_role() is distinct from 'comercial' or exists (select 1 from public.leads l where l.id = lead_attachments.lead_id))
  with check (public.current_job_role() is distinct from 'comercial' or exists (select 1 from public.leads l where l.id = lead_attachments.lead_id));

drop policy if exists conversations_comercial_own on public.conversations;
create policy conversations_comercial_own on public.conversations
  as restrictive for all
  using (public.current_job_role() is distinct from 'comercial' or (lead_id is not null and exists (select 1 from public.leads l where l.id = conversations.lead_id)))
  with check (public.current_job_role() is distinct from 'comercial' or (lead_id is not null and exists (select 1 from public.leads l where l.id = conversations.lead_id)));

drop policy if exists lead_attachments_storage_comercial_own on storage.objects;
create policy lead_attachments_storage_comercial_own on storage.objects
  as restrictive for all
  using (
    case
      when bucket_id <> 'lead-attachments' then true
      when public.current_job_role() is distinct from 'comercial' then true
      when (storage.foldername(name))[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
      else exists (select 1 from public.leads l where l.id = ((storage.foldername(name))[2])::uuid)
    end
  )
  with check (
    case
      when bucket_id <> 'lead-attachments' then true
      when public.current_job_role() is distinct from 'comercial' then true
      when (storage.foldername(name))[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
      else exists (select 1 from public.leads l where l.id = ((storage.foldername(name))[2])::uuid)
    end
  );
