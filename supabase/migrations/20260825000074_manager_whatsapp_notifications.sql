-- ============================================================
-- WhatsApp do gestor/dono responsável pela unidade (2026-08-25)
--
-- Pedido do Vinicius: "se o humano mandar msg tbm pedindo para marcar
-- ela marca, ou seja o humano cadastra um numero de whats como o humano
-- responsavel e ela sempre envia msg para ele no whats para
-- confirmações, informaçoes etc." — a Recepcionista precisa saber pra
-- QUAL número enviar o resumo diário da agenda, e reconhecer esse
-- número como comando administrativo (não cliente comum) quando ele
-- escreve. Antes não existia nenhum campo assim (só organizations.owner_email,
-- usado só pra e-mail de escalação/falha, nunca WhatsApp).
-- ============================================================

alter table units
  add column if not exists manager_whatsapp_phone text;

comment on column units.manager_whatsapp_phone is
  'WhatsApp do gestor/dono responsável pela unidade, cadastrado em Configurações — usado pelo cron do resumo diário da agenda (api/cron/manager-agenda-digest) e reconhecido como comando administrativo quando esse número escreve pra Recepcionista, ver inbound-router.ts.';
