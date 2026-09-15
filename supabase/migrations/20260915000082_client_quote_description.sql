-- ============================================================
-- AI Workforce OS — Migration 82: cotação estruturada por IA pro Portal 360
--
-- Pedido do Vinicius (2026-09-15): a 360 (rede) precisa montar uma
-- cotação profissional pro cliente final (ex.: gerente da loja) a
-- partir da anotação crua que o técnico deixa em campo
-- (service_order_material_description, em português, livre). Duas
-- colunas novas guardam o resultado gerado por IA (botão manual no
-- Portal 360, não automático como o resumo da Facil-IT):
--
--   service_order_quote_description_en — texto profissional em INGLÊS,
--     é o que de fato vai pro cliente final. Distinto de
--     service_order_scope_en (escopo original da ordem em si).
--   service_order_quote_description_pt — tradução em português do
--     texto acima, só pra quem está no escritório da 360 conferir na
--     íntegra o que está prestes a enviar antes de copiar/mandar.
-- ============================================================

alter table appointments
  add column if not exists service_order_quote_description_en text,
  add column if not exists service_order_quote_description_pt text;

comment on column appointments.service_order_quote_description_en is
  'Cotação estruturada em inglês, gerada por IA a partir de service_order_material_description — texto que vai de fato pro cliente final (Portal 360).';
comment on column appointments.service_order_quote_description_pt is
  'Tradução em português do texto acima, só para conferência de quem está no escritório da 360 — nunca enviado ao cliente.';
