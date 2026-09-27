-- Bug real (2026-09-27, achado com o Vinicius — WO 159373-02 da unidade
-- Mawi Pro não aparecia na Agenda): a Facil-IT reusa o mesmo
-- `orderNumber` interno quando uma ordem é revisada/reagendada, só
-- trocando o sufixo do PO (ex.: "159373-01" concluído em 18/09 virou
-- "159373-02" com nova visita em 28/09 — mesmo orderNumber 6188944 nos
-- dois). A dedup original (unit_id+facilit_order_number, migration 080)
-- não previa isso: o upsert diário sobrescrevia os dados da linha já
-- existente (po_number, visit_date, scope...) só nos metadados, mas
-- `ensureAppointmentForOrder` nunca criava o novo appointment porque a
-- linha JÁ tinha um appointment_id — o da visita ANTIGA, já concluída.
-- Resultado: a ordem revisada nunca aparecia na Agenda, silenciosamente.
--
-- Fix: dedupar por PO number quando ele existe (é o identificador real
-- de uma visita específica pra Facil-IT — cada revisão tem seu próprio
-- sufixo), caindo pra facilit_order_number só quando não há PO (mesma
-- rede de segurança de antes pra esse caso raro). Coluna própria em vez
-- de índice de expressão — Supabase upsert(onConflict:) só aceita nomes
-- de coluna de uma constraint real, não expressões.

alter table facilit_work_orders add column if not exists dedupe_key text;

update facilit_work_orders
set dedupe_key = coalesce(po_number, facilit_order_number)
where dedupe_key is null;

alter table facilit_work_orders alter column dedupe_key set not null;

alter table facilit_work_orders drop constraint if exists facilit_work_orders_unit_id_facilit_order_number_key;
alter table facilit_work_orders add constraint facilit_work_orders_unit_dedupe_key_key unique (unit_id, dedupe_key);
