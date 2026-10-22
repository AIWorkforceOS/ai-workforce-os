drop index if exists public.appointments_unit_intake_idx;
drop index if exists public.appointments_intake_email_unique;
alter table public.appointments drop constraint if exists appointments_intake_status_check;
alter table public.appointments drop column if exists intake_decided_by;
alter table public.appointments drop column if exists intake_decided_at;
alter table public.appointments drop column if exists intake_subject;
alter table public.appointments drop column if exists intake_from;
alter table public.appointments drop column if exists intake_email_id;
alter table public.appointments drop column if exists intake_status;
