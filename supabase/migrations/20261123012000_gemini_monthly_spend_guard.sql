-- Limite transacional de gasto para APIs pagas. A reserva acontece antes
-- da chamada externa e usa advisory lock para impedir estouro por concorrência.

alter table public.api_usage_events
  drop constraint if exists api_usage_events_provider_check;

alter table public.api_usage_events
  add constraint api_usage_events_provider_check
  check (provider in ('openai', 'gemini', 'google_maps', 'resend', 'evolution', 'twilio'));

create or replace function public.reserve_api_usage_budget(
  p_provider text,
  p_endpoint text,
  p_model text,
  p_estimated_cost_usd numeric,
  p_monthly_limit_usd numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month_start timestamptz := date_trunc('month', now());
  v_spent numeric;
begin
  if p_provider not in ('gemini')
     or p_estimated_cost_usd <= 0
     or p_monthly_limit_usd <= 0 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('api-budget:' || p_provider || ':' || v_month_start::text));

  select coalesce(sum(estimated_cost_usd), 0)
    into v_spent
    from public.api_usage_events
   where provider = p_provider
     and created_at >= v_month_start;

  if v_spent + p_estimated_cost_usd > p_monthly_limit_usd then
    return false;
  end if;

  insert into public.api_usage_events (
    provider, endpoint, model, estimated_cost_usd, metadata
  ) values (
    p_provider, p_endpoint, p_model, p_estimated_cost_usd,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('budget_reserved', true)
  );

  return true;
end;
$$;

revoke all on function public.reserve_api_usage_budget(text, text, text, numeric, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_api_usage_budget(text, text, text, numeric, numeric, jsonb) to service_role;
