-- Limites comerciais como regra de servidor. A interface apenas explica a
-- regra; estes triggers impedem que qualquer cliente, API ou tela antiga
-- ultrapasse o plano por escrita direta no Data API.

create or replace function public.organization_plan_limits(p_org_id uuid)
returns table(max_units integer, max_agents integer, max_leads_per_month integer)
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(p.max_units, 1), coalesce(p.max_agents, 1), coalesce(p.max_leads_per_month, 500)
  from public.organizations o
  left join public.plans p on p.id = o.plan_id or (o.plan_id is null and lower(p.slug) = lower(o.plan))
  where o.id = p_org_id
$$;

create or replace function public.enforce_unit_plan_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_limit integer;
  v_used integer;
begin
  if tg_op = 'UPDATE' and (not coalesce(new.is_active, false) or coalesce(old.is_active, false)) then
    return new;
  end if;
  if tg_op = 'INSERT' and not coalesce(new.is_active, true) then
    return new;
  end if;
  -- Serializa criações/ativações da mesma organização para duas requisições
  -- simultâneas não ultrapassarem o limite após contarem o mesmo uso.
  perform pg_advisory_xact_lock(hashtextextended(new.org_id::text, 0));
  select l.max_units into v_limit from public.organization_plan_limits(new.org_id) l;
  v_limit := coalesce(v_limit, 1);
  select count(*) into v_used from public.units where org_id = new.org_id and is_active = true;
  if v_used >= v_limit then
    raise exception using
      errcode = 'P0001',
      message = format('plan_unit_limit_reached: seu plano permite %s unidade(s) ativa(s); uso atual: %s. Faça upgrade para adicionar outra unidade.', v_limit, v_used);
  end if;
  return new;
end;
$$;

drop trigger if exists units_enforce_plan_limit on public.units;
create trigger units_enforce_plan_limit
before insert or update of is_active on public.units
for each row execute function public.enforce_unit_plan_limit();

create or replace function public.enforce_agent_plan_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org_id uuid;
  v_limit integer;
  v_used integer;
begin
  if not coalesce(new.is_active, false)
     or (tg_op = 'UPDATE' and coalesce(old.is_active, false) and new.unit_id = old.unit_id) then
    return new;
  end if;
  select org_id into v_org_id from public.units where id = new.unit_id;
  if v_org_id is null then
    raise exception using errcode = '23503', message = 'agent_unit_not_found: unidade inválida';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org_id::text, 0));
  select l.max_agents into v_limit from public.organization_plan_limits(v_org_id) l;
  v_limit := coalesce(v_limit, 1);
  select count(*) into v_used
  from public.agent_configs ac
  join public.units u on u.id = ac.unit_id
  where u.org_id = v_org_id and ac.is_active = true;
  if v_used >= v_limit then
    raise exception using
      errcode = 'P0001',
      message = format('plan_agent_limit_reached: seu plano permite %s funcionário(s) digital(is) ativo(s); uso atual: %s. Faça upgrade para ativar outro.', v_limit, v_used);
  end if;
  return new;
end;
$$;

drop trigger if exists agent_configs_enforce_plan_limit on public.agent_configs;
create trigger agent_configs_enforce_plan_limit
before insert or update of is_active, unit_id on public.agent_configs
for each row execute function public.enforce_agent_plan_limit();

grant execute on function public.organization_plan_limits(uuid) to authenticated;
