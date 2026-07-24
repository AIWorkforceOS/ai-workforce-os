-- ============================================================
-- Fatura também por WhatsApp/SMS (além do e-mail já existente):
-- registra o destino de telefone para o qual a fatura foi enviada,
-- espelhando invoices.sent_to_email.
-- ============================================================

alter table invoices
  add column if not exists sent_to_phone text;

comment on column invoices.sent_to_phone is
  'Telefone (WhatsApp ou SMS, conforme o canal da unidade) para o qual a fatura foi enviada com sucesso. Null = não enviada por telefone (sem telefone cadastrado, canal indisponível, ou falha no envio).';
