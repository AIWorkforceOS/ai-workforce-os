-- ============================================================
-- AI Workforce OS — Migration 31: admin de organização volta a
-- poder CRIAR unidade
--
-- Regressão introduzida pela migration 020 (dono de unidade): a
-- policy units_write (FOR ALL) passou a exigir can_access_unit(id)
-- também no INSERT. Para uma unidade que ainda não existe,
-- unit_org_id(id) não resolve (a linha nova não é visível para o
-- subselect da função stable durante o próprio INSERT), então
-- can_access_unit(id) é sempre falso — ou seja, desde 16/07 só o
-- super admin conseguia criar unidades; qualquer admin de empresa
-- cliente recebia violação de RLS (mascarada na UI como "slug já
-- está em uso").
--
-- Correção: separar a policy por operação.
--   INSERT — super admin, ou admin da própria org que NÃO seja dono
--     de unidade (current_app_unit_id() is null — dono de unidade
--     continua sem poder criar, como já era a intenção da 020).
--     A checagem é sobre os valores da linha nova (org_id), sem
--     depender de lookup da própria linha.
--   UPDATE/DELETE — exatamente a regra da 020 (com can_access_unit,
--     que aí sim funciona porque a linha existe).
-- ============================================================

drop policy if exists units_write on units;

drop policy if exists units_insert on units;
create policy units_insert on units
  for insert with check (
    public.is_super_admin()
    or (
      org_id = public.current_org_id()
      and public.is_org_admin()
      and public.current_app_unit_id() is null
    )
  );

drop policy if exists units_update on units;
create policy units_update on units
  for update using (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin() and public.can_access_unit(id))
  )
  with check (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin() and public.can_access_unit(id))
  );

drop policy if exists units_delete on units;
create policy units_delete on units
  for delete using (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin() and public.can_access_unit(id))
  );
