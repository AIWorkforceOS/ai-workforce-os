-- Super Agente de Cotações — Fase 2 / migration 095 (ADITIVA; NÃO aplicada até autorização).
-- Infra: limites de orçamento por empresa, cache de produtos (dado PÚBLICO), e funções atômicas de fila e orçamento
-- (executadas só pelo service role: revoke de public/anon/authenticated).

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

-- Pegar o próximo job (lease; vários workers nunca pegam o mesmo)
create or replace function public.claim_next_quote_job(p_worker text, p_lease_seconds integer default 300)
returns setof public.quote_analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with next as (
    select j.id
    from public.quote_analysis_jobs j
    where j.status in ('queued', 'running')
      and j.next_run_at <= now()
      and (j.locked_until is null or j.locked_until < now())
    order by j.next_run_at
    limit 1
    for update skip locked
  )
  update public.quote_analysis_jobs q
     set status = 'running',
         locked_by = p_worker,
         locked_until = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(q.started_at, now())
    from next
   where q.id = next.id
  returning q.*;
end;
$$;

-- Pegar UM job específico (a tela dispara logo após salvar), com a mesma garantia de lease
create or replace function public.claim_quote_job(p_job_id uuid, p_worker text, p_lease_seconds integer default 300)
returns setof public.quote_analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with target as (
    select j.id
    from public.quote_analysis_jobs j
    where j.id = p_job_id
      and j.status in ('queued', 'running')
      and (j.locked_until is null or j.locked_until < now())
    for update skip locked
  )
  update public.quote_analysis_jobs q
     set status = 'running',
         locked_by = p_worker,
         locked_until = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(q.started_at, now())
    from target
   where q.id = target.id
  returning q.*;
end;
$$;

-- Gasto do mês da empresa (liquidado + reservado) — base do teto mensal
create or replace function public.quote_org_month_spend(p_org uuid, p_now timestamptz default now())
returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce(sum(spent_usd + reserved_usd), 0)
  from public.quote_analysis_jobs
  where org_id = p_org
    and created_at >= date_trunc('month', p_now)
    and created_at < date_trunc('month', p_now) + interval '1 month';
$$;

-- RESERVAR orçamento ANTES de gastar (atômico). Devolve true só se couber no teto da cotação E no teto mensal da empresa.
create or replace function public.reserve_quote_budget(p_job_id uuid, p_amount numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.quote_analysis_jobs%rowtype;
  v_monthly_cap numeric;
  v_month_spend numeric;
begin
  if p_amount is null or p_amount < 0 then
    return false;
  end if;

  select * into v_job from public.quote_analysis_jobs where id = p_job_id for update;
  if not found then
    return false;
  end if;

  select monthly_cap_usd into v_monthly_cap from public.quote_org_limits where org_id = v_job.org_id;
  v_monthly_cap := coalesce(v_monthly_cap, 50);
  v_month_spend := public.quote_org_month_spend(v_job.org_id);

  if v_job.spent_usd + v_job.reserved_usd + p_amount > v_job.budget_usd then
    return false;
  end if;
  if v_month_spend + p_amount > v_monthly_cap then
    return false;
  end if;

  update public.quote_analysis_jobs set reserved_usd = reserved_usd + p_amount where id = p_job_id;
  return true;
end;
$$;

-- LIQUIDAR: troca a reserva pelo custo real da chamada (e acumula tokens/chamadas)
create or replace function public.settle_quote_budget(
  p_job_id uuid, p_reserved numeric, p_actual numeric, p_tokens_in bigint default 0, p_tokens_out bigint default 0
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.quote_analysis_jobs
     set reserved_usd = greatest(reserved_usd - coalesce(p_reserved, 0), 0),
         spent_usd = spent_usd + greatest(coalesce(p_actual, 0), 0),
         ai_calls = ai_calls + 1,
         tokens_in = tokens_in + coalesce(p_tokens_in, 0),
         tokens_out = tokens_out + coalesce(p_tokens_out, 0)
   where id = p_job_id;
$$;

-- Só o service role executa estas funções (nunca técnico/admin pelo navegador)
revoke all on function public.claim_next_quote_job(text, integer) from public, anon, authenticated;
revoke all on function public.claim_quote_job(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.quote_org_month_spend(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_quote_budget(uuid, numeric) from public, anon, authenticated;
revoke all on function public.settle_quote_budget(uuid, numeric, numeric, bigint, bigint) from public, anon, authenticated;
grant execute on function public.claim_next_quote_job(text, integer) to service_role;
grant execute on function public.claim_quote_job(uuid, text, integer) to service_role;
grant execute on function public.quote_org_month_spend(uuid, timestamptz) to service_role;
grant execute on function public.reserve_quote_budget(uuid, numeric) to service_role;
grant execute on function public.settle_quote_budget(uuid, numeric, numeric, bigint, bigint) to service_role;
