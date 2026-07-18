-- ============================================================
-- AI Workforce OS — Migration 23: integração de Tráfego Pago externo
-- (Smarter) por unidade
--
-- O Traffic Specialist (Meta Ads + Google Ads) já lê e otimiza campanhas
-- reais (migration 20260713000007), mas nunca escrevia nada de volta para
-- o Sistema Smarter — diferente de Vendas (migration 018) e Recrutamento
-- (migration 019), que já espelham dados lá. Esta migration fecha essa
-- lacuna: cada campanha gerida (ad_entities.entity_level = 'campaign')
-- passa a ser espelhada via POST/PATCH /api/partners/campaigns quando a
-- unidade tiver o token de parceiro configurado.
--
-- Diferente de CRM/Recruiting, aqui NÃO há um crm_integration_mode-like
-- toggle nativo×smarter: é só um espelhamento adicional opcional. Se o
-- token existir, sincroniza; se não existir, comportamento atual (nada
-- muda) — não há modo "nativo" alternativo porque o Traffic Specialist já
-- é 100% nativo por definição (gerencia contas de anúncio reais).
-- ============================================================

alter table units
  add column if not exists smarter_marketing_partner_token text;

comment on column units.smarter_marketing_partner_token is
  'Token de parceiro (Bearer, escopo marketing) da API de campanhas da Smarter para esta unidade especificamente — segredo, nunca exposto ao client. Quando presente, o cron do Traffic Specialist (lib/traffic/smarter-campaigns.ts) espelha as campanhas geridas em POST/PATCH /api/partners/campaigns. Null = comportamento atual, sem nenhuma chamada.';

alter table ad_entities
  add column if not exists smarter_campaign_id text;

comment on column ad_entities.smarter_campaign_id is
  'id da Campanha correspondente no Sistema Smarter (retornado pelo POST /api/partners/campaigns), usado para correlacionar os PATCHs seguintes de métricas. Só populado para entity_level = ''campaign'' quando a unidade tem smarter_marketing_partner_token configurado. Null = unidade não usa a integração ou a criação ainda não ocorreu/falhou.';
