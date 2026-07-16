-- ============================================================
-- AI Workforce OS — Migration 20: isolamento real por unidade
--
-- Até aqui, can_access_unit() só verificava se a unidade pertence à
-- MESMA ORGANIZAÇÃO do usuário logado — ou seja, qualquer usuário de
-- uma org com várias unidades (leads, conversas, candidatos, vagas,
-- CRM, segredos de integração em `units`) enxergava dados de TODAS as
-- unidades da própria org, não só da sua.
--
-- Esta migration introduz o conceito de "dono de unidade": um usuário
-- em public.users com unit_id preenchido só acessa a própria unidade.
-- Usuário com unit_id NULL (comportamento atual, preservado) continua
-- vendo todas as unidades da própria organização — é o admin/franqueadora.
-- ============================================================

alter table users
  add column if not exists unit_id uuid references units(id) on delete set null;

create index if not exists users_unit_idx on users(unit_id);

comment on column users.unit_id is
  'Preenchido = "dono de unidade": só acessa dados da própria unidade (ver can_access_unit()). NULL = admin da organização, vê todas as unidades da própria org (comportamento padrão).';

-- ------------------------------------------------------------
-- current_app_unit_id(): unit_id do usuário logado (NULL = admin de org)
-- ------------------------------------------------------------
create or replace function public.current_app_unit_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select u.unit_id
  from public.users u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and u.is_active
  limit 1;
$$;

grant execute on function public.current_app_unit_id() to anon, authenticated;

-- ------------------------------------------------------------
-- can_access_unit(): agora restringe "dono de unidade" à própria unidade.
-- super_admin -> tudo. admin de org (unit_id null) -> todas as unidades
-- da própria org (igual antes). dono de unidade (unit_id preenchido) ->
-- só a própria unidade.
-- ------------------------------------------------------------
create or replace function public.can_access_unit(target_unit uuid)
returns boolean
language sql stable
as $$
  select public.is_super_admin()
      or (
        target_unit is not null
        and public.unit_org_id(target_unit) = public.current_org_id()
        and (
          public.current_app_unit_id() is null
          or public.current_app_unit_id() = target_unit
        )
      );
$$;

-- ------------------------------------------------------------
-- UNITS: select/write passam a usar can_access_unit(id) em vez de
-- is_org_member(org_id) — hoje qualquer usuário da org via a lista de
-- TODAS as unidades (inclusive segredos como smarter_crm_partner_token
-- e evolution_api_key de unidades que não são a sua).
-- ------------------------------------------------------------
drop policy if exists units_select on units;
create policy units_select on units
  for select using (public.can_access_unit(id));

drop policy if exists units_write on units;
create policy units_write on units
  for all using (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin() and public.can_access_unit(id))
  )
  with check (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin() and public.can_access_unit(id))
  );
