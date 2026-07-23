-- ============================================================
-- AI Workforce OS — Migration 34: corrige units_select para não
-- depender de self-lookup (causa raiz real do bug de criação de
-- unidade, que sobreviveu às migrations 031 e 033)
--
-- Causa raiz encontrada em 22/07 via investigação direta em produção
-- (Supabase MCP + browser real de info@mawiproservice.com):
--   - A policy de INSERT (migration 033) estava correta e passava.
--   - O erro "new row violates row-level security policy for table
--     units" NÃO vinha do INSERT em si — vinha do RETURNING. O
--     client Supabase sempre faz INSERT ... RETURNING (ou
--     equivalente via Prefer: return=representation), e o Postgres
--     exige que a linha recém-criada também passe pela policy de
--     SELECT antes de devolvê-la.
--   - A policy antiga de SELECT usava can_access_unit(id), que por
--     baixo chama unit_org_id(target_unit) — uma função STABLE
--     SECURITY DEFINER que faz "select org_id from units where
--     id = target_unit". Esse self-lookup não enxerga a própria
--     linha que acabou de ser inserida na MESMA instrução (mesmo
--     problema documentado na migration 031, mas dessa vez batendo
--     no SELECT, não no INSERT).
--   - Prova direta: o mesmo INSERT sem RETURNING funcionava sempre;
--     só falhava quando pedia a linha de volta.
--
-- Correção: reescrever units_select para checar org_id/id
-- diretamente da linha (sem lookup próprio), com a mesma lógica de
-- can_access_unit. Lógica de permissão idêntica, só a forma de
-- checar muda — não afeta select normal, resolve o caso do
-- RETURNING durante INSERT.
--
-- Confirmado em produção antes de virar migration: INSERT real via
-- PostgREST (browser autenticado de info@mawiproservice.com) voltou
-- a funcionar (201) depois dessa mudança.
-- ============================================================

drop policy if exists units_select on units;
create policy units_select on units
  for select using (
    is_super_admin()
    or (
      org_id = current_org_id()
      and (current_app_unit_id() is null or current_app_unit_id() = id)
    )
  );
