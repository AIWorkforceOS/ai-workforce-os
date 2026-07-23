-- ============================================================
-- AI Workforce OS — Migration 33: reescreve units_insert sem
-- depender de funções STABLE/SECURITY DEFINER separadas
--
-- Contexto: mesmo com a migration 031 aplicada e corretamente
-- confirmada (policy units_insert existe, com a lógica certa no
-- papel), Vinicius reportou em 22/07 que uma conta real de
-- org_admin (info@mawiproservice.com, org "Mawi Cleaning") ainda
-- recebe violação de RLS ao tentar criar unidade.
--
-- Investigação (Dispatch, acesso direto ao Postgres de produção):
--   - Usuário confirmado como role='admin', org_id correto, sem
--     unit_id — deveria passar na regra.
--   - is_org_admin()/current_org_id()/current_app_unit_id() avaliados
--     manualmente (simulando o JWT do usuário) retornam exatamente
--     os valores que a policy exige.
--   - Mesmo assim, um INSERT de teste real falha com o mesmo erro.
--   - Controle: o mesmo INSERT simulando super_admin funciona.
--   - Teste adicional: mesmo uma policy adicional permissiva
--     "with check (true)" não deixou o INSERT passar durante a
--     investigação — o que indica que o método de teste via
--     SET ROLE dentro de uma sessão reaproveitada não é confiável
--     para validar RLS neste ambiente (problema conhecido de cache
--     de plano por role no Postgres), não necessariamente que a
--     regra em si está errada.
--
-- Decisão: como não foi possível validar com 100% de confiança via
-- simulação SQL, reescrevemos a policy usando o padrão recomendado
-- pela própria Supabase (EXISTS direto em auth.jwt(), sem passar por
-- funções wrapper STABLE/SECURITY DEFINER separadas) — mais robusto
-- e mais fácil de auditar, eliminando qualquer dependência de cache
-- de função entre chamadas. A lógica de permissão é EXATAMENTE a
-- mesma da migration 031 (super_admin, ou admin da própria org sem
-- unit_id), só a forma de checar muda.
--
-- IMPORTANTE: este fix só pode ser confirmado de verdade com um
-- teste real do Vinicius (login de verdade, não simulação) — testes
-- automatizados de RLS via SQL direto se mostraram não confiáveis
-- nesta investigação.
-- ============================================================

drop policy if exists units_insert on units;
create policy units_insert on units
  for insert with check (
    exists (
      select 1
      from public.users u
      where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and u.is_active
        and (
          u.role = 'super_admin'
          or (
            u.role = 'admin'
            and u.org_id = units.org_id
            and u.unit_id is null
          )
        )
    )
  );
