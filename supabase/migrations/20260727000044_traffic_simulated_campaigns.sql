-- ============================================================
-- AI Workforce OS — Migration 44: marca campanhas simuladas
--
-- lib/traffic/launcher.ts cai em modo mock (sem credenciais
-- configuradas na conta) ou dry_run (TRAFFIC_DRY_RUN=1) quando não
-- consegue/deve chamar a API de verdade — nesses casos os ids
-- externos são fake e a campanha NUNCA foi ao ar em nenhuma
-- plataforma. Até aqui essa linha em ad_entities ficava idêntica a uma
-- campanha real lançada de verdade, o que é enganoso: o dono via a
-- campanha no dashboard sem saber que ela nunca gerou um lead de
-- verdade. is_simulated marca essa diferença para a UI mostrar um
-- aviso claro.
-- ============================================================

alter table ad_entities
  add column if not exists is_simulated boolean not null default false;

comment on column ad_entities.is_simulated is
  'true quando a campanha foi criada em modo mock/dry_run (sem conta conectada de verdade ou TRAFFIC_DRY_RUN=1) — nunca foi ao ar em nenhuma plataforma real.';
