-- Rollback da migration 102 (faturamento por cliente). Rodar SOMENTE com autorização.
-- ATENÇÃO: apaga os vencimentos já informados por ordem (service_records.due_date) e os prazos padrão dos clientes.
-- Faturas já geradas pela função NÃO são apagadas (são faturas normais).
drop function if exists public.generate_client_invoice(uuid, text, uuid[], text, date, text);
drop index if exists public.service_records_unit_due_idx;
alter table public.client_company_profiles drop constraint if exists client_company_profiles_terms_range;
alter table public.client_company_profiles drop column if exists payment_terms_days;
alter table public.service_records drop column if exists due_date;
