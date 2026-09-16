-- ============================================================
-- AI Workforce OS — Migration 83: Facil-IT (360) restrita por organização
--
-- Pedido do Vinicius (2026-09-16): a integração com a Facil-IT é uma
-- funcionalidade específica do cliente Mawi Pro (rede 360) — não deve
-- aparecer no painel de nenhuma outra organização. Mesmo padrão de
-- feature flag já usado pra is_smarter_partner (migration inicial).
-- ============================================================

alter table organizations
  add column if not exists facilit_integration_enabled boolean not null default false;

comment on column organizations.facilit_integration_enabled is
  'true só pra Mawi Pro — libera o item de menu e as telas/rotas da integração Facil-IT (360). Ver lib/organizations.ts fetchOrganizationFacilitEnabled.';

update organizations
set facilit_integration_enabled = true
where id = '465fc182-e2a5-47d0-9694-0c6b1f9b619e';
