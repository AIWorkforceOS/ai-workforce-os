-- Migration 104 — Funções de acesso do escritório (Financeiro / Comercial / Operacional). ADITIVA; NÃO aplicada até autorização.
--  * users.job_role: NULL = administrador completo (TODOS os usuários atuais continuam assim, nada muda para eles).
--    Só restringe quem é role='admin'; técnico (employee) e cliente (client) seguem pelos papéis próprios.
--  * current_job_role(): a função do usuário logado (mesmo padrão de current_app_role()).
--  * Política RESTRITIVA nas três tabelas de financeiro da unidade/empresa: quem tem função Comercial ou Operacional não lê nem grava
--    financial_records, invoices e service_record_payments (RLS é a fronteira real; a tela só esconde). NULL e 'financeiro' passam.
--    Política restritiva soma-se às existentes (AND): não reescreve nenhuma política atual.
-- A trava 099 (users_guard_privileged_columns) já impede que alguém altere a própria função: job_role não está na lista de colunas livres.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.users add column if not exists job_role text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_job_role_check') then
    alter table public.users add constraint users_job_role_check check (job_role is null or job_role in ('financeiro', 'comercial', 'operacional'));
  end if;
end $$;
comment on column public.users.job_role is 'Função de acesso do escritório para role=admin: financeiro | comercial | operacional | NULL (administrador completo).';

create or replace function public.current_job_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select u.job_role
  from public.users u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and u.is_active
  limit 1;
$$;

drop policy if exists financial_records_job_role on public.financial_records;
create policy financial_records_job_role on public.financial_records
  as restrictive for all
  using (public.current_job_role() is null or public.current_job_role() = 'financeiro')
  with check (public.current_job_role() is null or public.current_job_role() = 'financeiro');

drop policy if exists invoices_job_role on public.invoices;
create policy invoices_job_role on public.invoices
  as restrictive for all
  using (public.current_job_role() is null or public.current_job_role() = 'financeiro')
  with check (public.current_job_role() is null or public.current_job_role() = 'financeiro');

drop policy if exists service_record_payments_job_role on public.service_record_payments;
create policy service_record_payments_job_role on public.service_record_payments
  as restrictive for all
  using (public.current_job_role() is null or public.current_job_role() = 'financeiro')
  with check (public.current_job_role() is null or public.current_job_role() = 'financeiro');

-- As funções de banco que movem dinheiro (generate_client_invoice, consolidate_invoices, register_service_record_payment…) são SECURITY DEFINER e
-- contornam a RLS acima. Esta trava de gatilho fecha esse caminho: qualquer escrita nas três tabelas, mesmo por essas funções, falha para quem
-- tem função Comercial/Operacional (a decisão usa o JWT, que continua valendo dentro da função). Service role/cron não têm JWT de usuário: passam.
create or replace function public.block_restricted_job_role_finance() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.current_job_role() in ('comercial', 'operacional') then
    raise exception 'Sem permissão: a função do seu usuário não inclui o financeiro.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists invoices_job_role_guard on public.invoices;
create trigger invoices_job_role_guard before insert or update or delete on public.invoices for each row execute function public.block_restricted_job_role_finance();
drop trigger if exists service_record_payments_job_role_guard on public.service_record_payments;
create trigger service_record_payments_job_role_guard before insert or update or delete on public.service_record_payments for each row execute function public.block_restricted_job_role_finance();
drop trigger if exists financial_records_job_role_guard on public.financial_records;
create trigger financial_records_job_role_guard before insert or update or delete on public.financial_records for each row execute function public.block_restricted_job_role_finance();
