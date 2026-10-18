-- Super Agente de Cotações — Fase 2 / migration 095 (ADITIVA; NÃO aplicada até autorização).
-- Infra: limites de orçamento por empresa, cache de produtos (dado PÚBLICO), e funções atômicas de fila e orçamento
-- (executadas só pelo service role: revoke de public/anon/authenticated).
-- Segurança de aplicação: falha rápido em vez de travar atrás de transação longa (ex.: sync da Facil-IT) e nunca roda sem limite.
set local lock_timeout = '5s';
set local statement_timeout = '60s';


-- Limites por empresa (editáveis só por super admin). Sem linha = padrão do piloto (US$ 0,60 por cotação / US$ 50 por mês).
create table if not exists public.quote_org_limits (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  per_quote_cap_usd numeric(10,4) not null default 0.60 check (per_quote_cap_usd >= 0),
  monthly_cap_usd numeric(10,2) not null default 50 check (monthly_cap_usd >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.quote_org_limits enable row level security;
drop policy if exists quote_org_limits_super_admin on public.quote_org_limits;
create policy quote_org_limits_super_admin on public.quote_org_limits
  for all using (public.is_super_admin()) with check (public.is_super_admin());
-- admin da empresa pode LER o próprio limite (ver quanto resta), não alterar
drop policy if exists quote_org_limits_admin_read on public.quote_org_limits;
create policy quote_org_limits_admin_read on public.quote_org_limits
  for select using (public.is_org_admin() and public.is_org_member(org_id));

-- Cache de pesquisa de produtos: dado PÚBLICO de catálogo (nenhum dado de cliente/ordem). Sem policy = só service role.
create table if not exists public.product_price_cache (
  id uuid primary key default uuid_generate_v4(),
  supplier text not null,
  query_hash text not null,
  normalized_query text not null,
  result jsonb not null,
  retrieved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint product_price_cache_unique unique (supplier, query_hash)
);
create index if not exists product_price_cache_expiry_idx on public.product_price_cache (expires_at);
alter table public.product_price_cache enable row level security;

-- ===============================================================
-- ORÇAMENTO DE IA — três baldes por cotação, razão (ledger) por reserva
--   spent_usd       = gasto CONFIRMADO (custo real medido pela resposta da API)
--   reserved_usd    = reservas ATIVAS (chamada em andamento; pior caso)
--   unconfirmed_usd = reservas INTERROMPIDAS contabilizadas preventivamente (pior caso; custo real desconhecido)
-- Os tetos (US$ 0,60 por cotação / US$ 50 por mês) somam os TRÊS. Cada reserva é uma linha no razão, com id próprio:
--   * liquidar é idempotente (a mesma reserva nunca é cobrada duas vezes);
--   * reserva interrompida NÃO vira "gasto": vira "não confirmada" e pode ser reconciliada depois com o custo real;
--   * ordem de travas SEMPRE: lock da empresa -> linha do job -> linha da reserva (sem deadlock).
-- ===============================================================
create table if not exists public.quote_budget_reservations (
  id uuid primary key default uuid_generate_v4(),
  job_id uuid not null references public.quote_analysis_jobs(id) on delete cascade,
  org_id uuid not null,
  amount_usd numeric(12,6) not null check (amount_usd >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'released', 'unconfirmed', 'reconciled')),
  actual_usd numeric(12,6) check (actual_usd is null or actual_usd >= 0),
  overrun_usd numeric(12,6) not null default 0 check (overrun_usd >= 0),  -- custo real acima do pior caso estimado (alarme: a estimativa subestimou)
  note text,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  check (status in ('reserved', 'unconfirmed') or actual_usd is not null)
);
create index if not exists quote_reservations_job_idx on public.quote_budget_reservations (job_id);
create index if not exists quote_reservations_org_month_idx on public.quote_budget_reservations (org_id, created_at);
create index if not exists quote_reservations_open_idx on public.quote_budget_reservations (created_at) where status in ('reserved', 'unconfirmed');
alter table public.quote_budget_reservations enable row level security;  -- sem policy: só o service role (nenhum técnico/admin lê pelo navegador)

-- Reservas ativas de UM job viram "não confirmadas" (worker perdido / estouro de tempo). O CHAMADOR já deve ter a linha do job travada.
create or replace function public.quote_expire_job_reservations(p_job uuid, p_note text default 'interrompida: sem liquidação (worker perdido ou tempo esgotado)')
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moved numeric;
begin
  with moved as (
    update public.quote_budget_reservations
       set status = 'unconfirmed', note = coalesce(note, p_note)
     where job_id = p_job and status = 'reserved'
    returning amount_usd
  )
  select coalesce(sum(amount_usd), 0) into v_moved from moved;
  if v_moved > 0 then
    update public.quote_analysis_jobs
       set reserved_usd = greatest(reserved_usd - v_moved, 0),
           unconfirmed_usd = unconfirmed_usd + v_moved
     where id = p_job;
  end if;
  return v_moved;
end;
$$;

-- Pegar o próximo job (lease; vários workers nunca pegam o mesmo). Regras de proteção:
--  * lock consultivo serializa as tomadas (evita corrida na contagem de concorrência);
--  * no máximo p_max_concurrent jobs rodando ao mesmo tempo (cron por minuto pode sobrepor invocações);
--  * ao tomar um job, reservas que ficaram presas (chamada que morreu/estourou o tempo) viram NÃO CONFIRMADAS (pior caso
--    continua contando nos tetos, mas não é registrada como gasto real e pode ser reconciliada depois).
create or replace function public.claim_next_quote_job(p_worker text, p_lease_seconds integer default 300, p_max_concurrent integer default 3)
returns setof public.quote_analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_running integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('quote_claim'));

  select count(*) into v_running
    from public.quote_analysis_jobs
   where status = 'running' and locked_until is not null and locked_until > now();
  if v_running >= p_max_concurrent then
    return;
  end if;

  select j.id into v_id
    from public.quote_analysis_jobs j
   where j.status in ('queued', 'running')
     and j.next_run_at <= now()
     and (j.locked_until is null or j.locked_until < now())
   order by j.next_run_at
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;

  perform public.quote_expire_job_reservations(v_id);

  return query
  update public.quote_analysis_jobs q
     set status = 'running',
         locked_by = p_worker,
         locked_until = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(q.started_at, now())
   where q.id = v_id
  returning q.*;
end;
$$;

create or replace function public.claim_quote_job(p_job_id uuid, p_worker text, p_lease_seconds integer default 300)
returns setof public.quote_analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select j.id into v_id
    from public.quote_analysis_jobs j
   where j.id = p_job_id
     and j.status in ('queued', 'running')
     and (j.locked_until is null or j.locked_until < now())
   for update skip locked;
  if v_id is null then
    return;
  end if;

  perform public.quote_expire_job_reservations(v_id);

  return query
  update public.quote_analysis_jobs q
     set status = 'running',
         locked_by = p_worker,
         locked_until = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(q.started_at, now())
   where q.id = v_id
  returning q.*;
end;
$$;

-- Gasto do mês da empresa = confirmado + ativo + não confirmado (a partir do RAZÃO; independe de quando o job foi criado)
create or replace function public.quote_org_month_spend(p_org uuid, p_now timestamptz default now())
returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce(sum(case status
                        when 'reserved' then amount_usd
                        when 'unconfirmed' then amount_usd
                        when 'released' then 0
                        else actual_usd end), 0)
  from public.quote_budget_reservations
  where org_id = p_org
    and created_at >= date_trunc('month', p_now)
    and created_at < date_trunc('month', p_now) + interval '1 month';
$$;

-- Relatório do mês por balde (admin/super admin via service role): confirmado x ativo x não confirmado
create or replace function public.quote_org_budget_report(p_org uuid, p_now timestamptz default now())
returns table (confirmed_usd numeric, active_usd numeric, unconfirmed_usd numeric, total_usd numeric, unconfirmed_count bigint, overrun_usd numeric)
language sql stable security definer
set search_path = public
as $$
  select
    coalesce(sum(case when status in ('settled', 'reconciled') then actual_usd else 0 end), 0),
    coalesce(sum(case when status = 'reserved' then amount_usd else 0 end), 0),
    coalesce(sum(case when status = 'unconfirmed' then amount_usd else 0 end), 0),
    public.quote_org_month_spend(p_org, p_now),
    count(*) filter (where status = 'unconfirmed'),
    coalesce(sum(overrun_usd), 0)
  from public.quote_budget_reservations
  where org_id = p_org
    and created_at >= date_trunc('month', p_now)
    and created_at < date_trunc('month', p_now) + interval '1 month';
$$;

-- RESERVAR orçamento ANTES de gastar (atômico). Devolve o id da reserva, ou NULL se não couber no teto da cotação OU no teto mensal.
--  * lock consultivo por empresa (dois jobs da MESMA empresa não passam juntos pelo teto mensal);
--  * trava a linha do job (duas chamadas do MESMO job nunca reservam juntas);
--  * só reserva para job em execução (status running) — job parado/terminado não gasta.
create or replace function public.reserve_quote_budget(p_job_id uuid, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_job public.quote_analysis_jobs%rowtype;
  v_monthly_cap numeric;
  v_id uuid;
begin
  if p_amount is null or p_amount < 0 then
    return null;
  end if;

  select org_id into v_org from public.quote_analysis_jobs where id = p_job_id;
  if v_org is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('quote_budget:' || v_org::text));

  select * into v_job from public.quote_analysis_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'running' then
    return null;
  end if;

  select monthly_cap_usd into v_monthly_cap from public.quote_org_limits where org_id = v_job.org_id;
  v_monthly_cap := coalesce(v_monthly_cap, 50);

  if v_job.spent_usd + v_job.reserved_usd + v_job.unconfirmed_usd + p_amount > v_job.budget_usd then
    return null;
  end if;
  if public.quote_org_month_spend(v_job.org_id) + p_amount > v_monthly_cap then
    return null;
  end if;

  insert into public.quote_budget_reservations (job_id, org_id, amount_usd) values (p_job_id, v_job.org_id, p_amount) returning id into v_id;
  update public.quote_analysis_jobs set reserved_usd = reserved_usd + p_amount where id = p_job_id;
  return v_id;
end;
$$;

-- LIQUIDAR: troca a reserva pelo custo REAL medido. Idempotente: segunda chamada com a mesma reserva não cobra de novo (devolve false).
-- Também aceita reserva já "não confirmada" (worker lento que respondeu depois do cron): a estimativa preventiva vira custo real.
create or replace function public.settle_quote_budget(p_reservation_id uuid, p_actual numeric, p_tokens_in bigint default 0, p_tokens_out bigint default 0)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job uuid;
  r public.quote_budget_reservations%rowtype;
  v_actual numeric := greatest(coalesce(p_actual, 0), 0);
begin
  select job_id into v_job from public.quote_budget_reservations where id = p_reservation_id;
  if v_job is null then
    return false;
  end if;
  perform 1 from public.quote_analysis_jobs where id = v_job for update;
  select * into r from public.quote_budget_reservations where id = p_reservation_id for update;
  if r.status not in ('reserved', 'unconfirmed') then
    return false;
  end if;

  update public.quote_analysis_jobs
     set reserved_usd = greatest(reserved_usd - case when r.status = 'reserved' then r.amount_usd else 0 end, 0),
         unconfirmed_usd = greatest(unconfirmed_usd - case when r.status = 'unconfirmed' then r.amount_usd else 0 end, 0),
         spent_usd = spent_usd + v_actual,
         ai_calls = ai_calls + 1,
         tokens_in = tokens_in + coalesce(p_tokens_in, 0),
         tokens_out = tokens_out + coalesce(p_tokens_out, 0)
   where id = v_job;
  update public.quote_budget_reservations
     set status = 'settled', actual_usd = v_actual, overrun_usd = greatest(v_actual - amount_usd, 0), finalized_at = now()
   where id = p_reservation_id;
  return true;
end;
$$;

-- LIBERAR: só para falha em que a chamada comprovadamente NÃO foi enviada/cobrada (ex.: foto não carregou, validação local, HTTP 4xx).
-- Em falha ambígua (timeout, queda de rede, 5xx depois de enviar) NÃO se libera: usa-se mark_quote_reservation_unconfirmed.
create or replace function public.release_quote_budget(p_reservation_id uuid, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job uuid;
  r public.quote_budget_reservations%rowtype;
begin
  select job_id into v_job from public.quote_budget_reservations where id = p_reservation_id;
  if v_job is null then
    return false;
  end if;
  perform 1 from public.quote_analysis_jobs where id = v_job for update;
  select * into r from public.quote_budget_reservations where id = p_reservation_id for update;
  if r.status <> 'reserved' then
    return false;
  end if;
  update public.quote_analysis_jobs set reserved_usd = greatest(reserved_usd - r.amount_usd, 0) where id = v_job;
  update public.quote_budget_reservations set status = 'released', actual_usd = 0, note = coalesce(p_note, note), finalized_at = now() where id = p_reservation_id;
  return true;
end;
$$;

-- Falha AMBÍGUA: a reserva (pior caso) continua contando nos tetos, mas passa a "não confirmada" até reconciliar com o custo real.
create or replace function public.mark_quote_reservation_unconfirmed(p_reservation_id uuid, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job uuid;
  r public.quote_budget_reservations%rowtype;
begin
  select job_id into v_job from public.quote_budget_reservations where id = p_reservation_id;
  if v_job is null then
    return false;
  end if;
  perform 1 from public.quote_analysis_jobs where id = v_job for update;
  select * into r from public.quote_budget_reservations where id = p_reservation_id for update;
  if r.status <> 'reserved' then
    return false;
  end if;
  update public.quote_analysis_jobs set reserved_usd = greatest(reserved_usd - r.amount_usd, 0), unconfirmed_usd = unconfirmed_usd + r.amount_usd where id = v_job;
  update public.quote_budget_reservations set status = 'unconfirmed', note = coalesce(p_note, note) where id = p_reservation_id;
  return true;
end;
$$;

-- RECONCILIAÇÃO COM DADOS REAIS (manual/super admin ou rotina futura com o relatório de uso da OpenAI): troca o pior caso preventivo
-- pelo custo real (pode ser 0 se a chamada nunca foi cobrada). Idempotente: só age sobre reserva "unconfirmed".
create or replace function public.reconcile_quote_reservation(p_reservation_id uuid, p_actual numeric, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job uuid;
  r public.quote_budget_reservations%rowtype;
  v_actual numeric := greatest(coalesce(p_actual, 0), 0);
begin
  select job_id into v_job from public.quote_budget_reservations where id = p_reservation_id;
  if v_job is null then
    return false;
  end if;
  perform 1 from public.quote_analysis_jobs where id = v_job for update;
  select * into r from public.quote_budget_reservations where id = p_reservation_id for update;
  if r.status <> 'unconfirmed' then
    return false;
  end if;
  update public.quote_analysis_jobs
     set unconfirmed_usd = greatest(unconfirmed_usd - r.amount_usd, 0), spent_usd = spent_usd + v_actual
   where id = v_job;
  update public.quote_budget_reservations
     set status = 'reconciled', actual_usd = v_actual, overrun_usd = greatest(v_actual - amount_usd, 0), note = coalesce(p_note, note), finalized_at = now()
   where id = p_reservation_id;
  return true;
end;
$$;

-- VARREDURA (cron): reserva ativa há mais de N minutos em job sem worker vivo vira "não confirmada" (NUNCA "gasto confirmado").
-- Pula (skip locked) jobs que estão sendo usados agora; a próxima rodada pega.
create or replace function public.reconcile_quote_budgets(p_stale_minutes integer default 10)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job uuid;
  v_count integer := 0;
begin
  for v_job in
    select distinct r.job_id
      from public.quote_budget_reservations r
      join public.quote_analysis_jobs j on j.id = r.job_id
     where r.status = 'reserved'
       and r.created_at < now() - make_interval(mins => p_stale_minutes)
       and (j.status <> 'running' or j.locked_until is null or j.locked_until < now())
  loop
    perform 1 from public.quote_analysis_jobs where id = v_job for update skip locked;
    if found and public.quote_expire_job_reservations(v_job) > 0 then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Só o service role executa estas funções (nunca técnico/admin pelo navegador)
revoke all on function public.quote_expire_job_reservations(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_next_quote_job(text, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_quote_job(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.quote_org_month_spend(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.quote_org_budget_report(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_quote_budget(uuid, numeric) from public, anon, authenticated;
revoke all on function public.settle_quote_budget(uuid, numeric, bigint, bigint) from public, anon, authenticated;
revoke all on function public.release_quote_budget(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_quote_reservation_unconfirmed(uuid, text) from public, anon, authenticated;
revoke all on function public.reconcile_quote_reservation(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.reconcile_quote_budgets(integer) from public, anon, authenticated;
grant execute on function public.claim_next_quote_job(text, integer, integer) to service_role;
grant execute on function public.claim_quote_job(uuid, text, integer) to service_role;
grant execute on function public.quote_org_month_spend(uuid, timestamptz) to service_role;
grant execute on function public.quote_org_budget_report(uuid, timestamptz) to service_role;
grant execute on function public.reserve_quote_budget(uuid, numeric) to service_role;
grant execute on function public.settle_quote_budget(uuid, numeric, bigint, bigint) to service_role;
grant execute on function public.release_quote_budget(uuid, text) to service_role;
grant execute on function public.mark_quote_reservation_unconfirmed(uuid, text) to service_role;
grant execute on function public.reconcile_quote_reservation(uuid, numeric, text) to service_role;
grant execute on function public.reconcile_quote_budgets(integer) to service_role;
