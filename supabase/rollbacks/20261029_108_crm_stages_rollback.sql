drop index if exists public.leads_stage_idx;
alter table public.leads drop column if exists stage_id;
drop table if exists public.crm_stages;
