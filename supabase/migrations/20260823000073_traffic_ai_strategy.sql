-- ============================================================
-- AI Workforce OS — Migration 73: Tráfego Pago — estratégia gerada por IA
--
-- Pedido do Vinicius (2026-08-23): até aqui campaign_creative_drafts
-- (migration 041) guardava um rascunho cujo `spec` (orçamento, público,
-- texto) já vinha PRONTO de quem chamava a rota — não existia geração de
-- estratégia nenhuma, só geração de imagem. O funcionário de Tráfego
-- precisa estudar o negócio de verdade e propor a campanha inteira
-- (público, verba, previsão de leads/custo), deixando o humano só ajustar
-- a verba se quiser e aprovar.
--
-- Colunas novas em campaign_creative_drafts: a previsão de leads/custo é
-- sempre uma ESTIMATIVA (sem histórico de conta nova não dá pra prometer
-- número exato) — nunca escondida como garantia, ver lib/traffic/
-- strategy-generator.ts. reasoning aqui é o raciocínio da ESTRATÉGIA
-- (público/orçamento/objetivo); já existe reasoning implícito da imagem
-- em image_prompt, mas não um texto legível — este campo cobre os dois.
-- ============================================================

alter table campaign_creative_drafts
  add column if not exists reasoning text,
  add column if not exists predicted_leads_min int,
  add column if not exists predicted_leads_max int,
  add column if not exists predicted_total_cost_cents int,
  add column if not exists prediction_period_days int default 30;
