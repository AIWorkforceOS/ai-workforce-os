-- Migration 104 — Ordem de serviço recebida por e-mail ("aguardando aceite"). ADITIVA; NÃO aplicada até autorização.
-- Só acrescenta colunas anuláveis em appointments: NULL = ordem normal (todas as existentes). Nada existente muda.
--  * intake_status: 'awaiting_accept' (chegou por e-mail, o administrador ainda não aceitou) | 'refused' | NULL
--  * intake_email_id: id do e-mail recebido (idempotência: o mesmo e-mail nunca cria duas ordens)
--  * intake_from / intake_subject: de quem e o assunto, para o administrador decidir
-- O guard de funcionário (appointments_guard_employee_write) já bloqueia colunas fora da lista permitida.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.appointments add column if not exists intake_status text;
alter table public.appointments add column if not exists intake_email_id text;
alter table public.appointments add column if not exists intake_from text;
alter table public.appointments add column if not exists intake_subject text;
alter table public.appointments add column if not exists intake_decided_at timestamptz;
alter table public.appointments add column if not exists intake_decided_by uuid references public.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_intake_status_check') then
    alter table public.appointments add constraint appointments_intake_status_check check (intake_status is null or intake_status in ('awaiting_accept', 'refused'));
  end if;
end $$;

create unique index if not exists appointments_intake_email_unique on public.appointments (unit_id, intake_email_id) where intake_email_id is not null;
create index if not exists appointments_unit_intake_idx on public.appointments (unit_id) where intake_status = 'awaiting_accept';

comment on column public.appointments.intake_status is 'Ordem recebida por e-mail: awaiting_accept | refused | NULL (ordem normal ou já aceita).';
