-- ============================================================
-- AI Workforce OS — Migration 48: dados de cobrança da unidade
--
-- Pedido do dono do produto: a fatura em PDF anexada ao e-mail
-- (lib/invoices/pdf.ts) precisa mostrar quem está cobrando — hoje só
-- temos units.name (usado internamente) e nenhum endereço/telefone/
-- instruções de pagamento formais. Os dados do cliente que está sendo
-- cobrado já existem em customers (name/email/phone/address); só
-- faltava o lado de quem cobra.
--
-- billing_payment_instructions é texto livre (não campos estruturados
-- de Zelle/PIX) porque a Alizo atende BR e EUA na mesma tela — cada
-- unidade escreve o que faz sentido pro seu mercado, mesmo padrão já
-- usado em invoices.notes (instruções de pagamento por fatura).
--
-- RLS: nenhuma policy nova — units_select (can_access_unit) e
-- units_write (can_access_unit + is_org_admin, migration 020) já
-- cobrem a tabela inteira, incluindo colunas novas.
-- ============================================================

alter table units
  add column if not exists billing_company_name text,
  add column if not exists billing_address text,
  add column if not exists billing_email text,
  add column if not exists billing_phone text,
  add column if not exists billing_payment_instructions text;

comment on column units.billing_company_name is
  'Nome da empresa que cobra, exibido na fatura em PDF. Null = usa units.name.';
comment on column units.billing_address is
  'Endereço de quem cobra, exibido na fatura em PDF.';
comment on column units.billing_email is
  'E-mail de quem cobra, exibido na fatura em PDF.';
comment on column units.billing_phone is
  'Telefone de quem cobra, exibido na fatura em PDF.';
comment on column units.billing_payment_instructions is
  'Instruções de pagamento em texto livre (Zelle nos EUA, PIX no Brasil, etc.), exibidas no rodapé da fatura em PDF.';
