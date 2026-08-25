-- ============================================================
-- Referência da cobrança na processadora, por financial_record
-- (2026-08-25)
--
-- Pedido do Vinicius: garantia de 7 dias precisa ESTORNAR de verdade a
-- cobrança do cartão quando o cliente cancela dentro do prazo, não só
-- parar a cobrança futura. Pra chamar POST /v3/payments/{id}/refund
-- (Asaas) ou POST /v1/refunds (Stripe) automaticamente, precisamos saber
-- QUAL cobrança exata pagar — isso nunca foi gravado antes (webhook-handler.ts
-- só atualizava status/paid_at). Populado pelo webhook quando o pagamento
-- confirma (event.providerChargeRef na maioria dos eventos de sucesso é o
-- id da cobrança em si — ver asaas-provider.ts/stripe-provider.ts).
-- ============================================================

alter table financial_records
  add column if not exists provider_payment_ref text;

comment on column financial_records.provider_payment_ref is
  'Id da cobrança na processadora (Asaas payment id / Stripe charge id) — usado pelo estorno automático dentro da garantia de 7 dias (api/billing/cancel). Populado por webhook-handler.ts quando o pagamento é confirmado.';
