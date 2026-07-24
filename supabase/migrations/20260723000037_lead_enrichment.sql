-- ============================================================
-- AI Workforce OS — Migration 37: pesquisa automática do lead
-- (Sales Rep / SDR) antes do primeiro contato
--
-- Antes de mandar a primeira mensagem (WhatsApp/e-mail) para um lead
-- novo — prospectado via Google Maps, vindo de tráfego pago ou criado
-- manualmente — o SDR agora pesquisa a empresa (Google Places +
-- website, ver lib/leads/enrichment.ts) para personalizar a abordagem
-- em vez de usar um template genérico. Guardado aqui para não repetir
-- a pesquisa a cada mensagem (enriched_at marca que já foi tentada,
-- mesmo quando não encontrou nada) e para poder exibir na UI depois.
-- ============================================================

alter table leads
  add column if not exists enrichment_data jsonb,
  add column if not exists enriched_at timestamptz;

comment on column leads.enrichment_data is
  'Pesquisa automática da empresa do lead antes do primeiro contato: { website, summary, contact_email, place_id } (lib/leads/enrichment.ts). Null = pesquisa não encontrou nada (site fora do ar, empresa não encontrada no Maps, etc.) — nunca bloqueia o funil.';
comment on column leads.enriched_at is
  'Quando a pesquisa de enrichment_data foi tentada (com ou sem sucesso) — evita pesquisar de novo a cada mensagem para o mesmo lead.';
