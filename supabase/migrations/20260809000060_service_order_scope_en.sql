-- ============================================================
-- AI Workforce OS — Migration 60: escopo do trabalho em inglês
-- (PDF final da ordem de serviço)
--
-- Pedido do dono do produto: o PDF baixável (Sign Off Sheet, migration
-- 059) vai direto pro cliente (360/Mawi) e não pode ter nada em
-- português. Até aqui a seção "Scope Of Work" do PDF usava
-- service_order_summary_pt (migration 056), que o PROMPT de extração
-- pede explicitamente em português — útil como resumo interno pro
-- TÉCNICO no Portal do Funcionário, mas errado pro documento final.
--
-- Este campo novo guarda o texto do escopo em INGLÊS (geralmente o
-- texto original do documento da 360, que já chega em inglês) —
-- extraído com a mesma fidelidade/sem corte que já existe pra
-- summary_pt (ver lib/service-orders/extraction.ts). service_order_summary_pt
-- continua existindo e sendo usado pelo técnico; este campo é só pro
-- PDF (lib/service-orders/pdf.ts).
-- ============================================================

alter table appointments
  add column if not exists service_order_scope_en text;

comment on column appointments.service_order_scope_en is
  'Texto do "Scope Of Work" em INGLÊS, fiel ao documento original da contratante — usado no PDF final (Sign Off Sheet) que vai pro cliente, nunca traduzido/resumido em português. Distinto de service_order_summary_pt (resumo em português, uso interno do técnico no Portal do Funcionário). Preenchido pelo admin, pré-preenchido pela extração por IA quando legível.';
