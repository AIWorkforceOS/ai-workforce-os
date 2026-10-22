drop table if exists public.lead_activities;
drop index if exists public.leads_owner_idx;
alter table public.leads drop column if exists owner_user_id;
