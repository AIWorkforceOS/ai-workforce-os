alter table public.appointments drop constraint if exists appointments_quote_decision_check;
alter table public.appointments drop column if exists quote_decision_note;
alter table public.appointments drop column if exists quote_decided_by;
alter table public.appointments drop column if exists quote_decided_at;
alter table public.appointments drop column if exists quote_decision;
