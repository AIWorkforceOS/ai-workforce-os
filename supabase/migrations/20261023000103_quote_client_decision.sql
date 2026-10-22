-- Migration 103 — Decisão do cliente sobre a cotação (aprovada / recusada). ADITIVA; NÃO aplicada até autorização.
-- Só acrescenta colunas anuláveis em appointments: NULL = "aguardando aprovação" (como todas as ordens existentes estão hoje).
-- Nenhum dado, valor financeiro ou política existente é alterado. O guard de funcionário (appointments_guard_employee_write)
-- já bloqueia colunas fora da lista permitida, então funcionário não consegue gravar a decisão.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.appointments add column if not exists quote_decision text;
alter table public.appointments add column if not exists quote_decided_at timestamptz;
alter table public.appointments add column if not exists quote_decided_by uuid references public.users(id) on delete set null;
alter table public.appointments add column if not exists quote_decision_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_quote_decision_check') then
    alter table public.appointments add constraint appointments_quote_decision_check check (quote_decision is null or quote_decision in ('approved', 'rejected'));
  end if;
end $$;

comment on column public.appointments.quote_decision is 'Decisão do cliente sobre a cotação desta ordem: approved | rejected | NULL (aguardando). Registrada pelo administrador no painel do cliente.';
