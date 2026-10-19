-- ROLLBACK do Super Agente de Cotações (migrations 093–098; a 097 só fixa search_path e some junto com as funções). NÃO é uma migration: só roda sob decisão manual.
-- PASSO 0 (não destrutivo, prefira este): colocar todas as unidades em 'off' e definir QUOTE_TEAM_ENABLED=false.
--     update public.units set quote_ai_team_mode = 'off';
-- Este script REMOVE as tabelas do módulo (e os dados de análises de cotação que existirem nelas). Exporte antes, se precisar.
-- NÃO toca em appointments, service_order_*, fotos, fila offline, PWA, financeiro nem em nenhum dado existente.
-- Ordem inversa das dependências. Idempotente (pode rodar mais de uma vez).
begin;
set local lock_timeout = '5s';

-- 098 (piloto): conversa, avaliação do piloto, campos de compra, flag de técnico e índice de um job por WO
drop table if exists public.quote_pilot_reviews;
drop table if exists public.quote_messages;
drop index if exists public.quote_jobs_one_per_appointment;
alter table if exists public.quote_analysis_jobs drop column if exists rounds;
alter table if exists public.quote_items drop constraint if exists quote_items_product_url_https;
alter table if exists public.quote_items drop constraint if exists quote_items_price_source_valid;
alter table if exists public.quote_items drop column if exists supplier, drop column if exists product_url, drop column if exists price_source, drop column if exists price_checked_at;
alter table public.employees drop column if exists quote_agent_enabled;
alter table if exists public.quote_org_limits drop constraint if exists quote_org_limits_pilot_max_quotes_valid;
alter table if exists public.quote_org_limits drop column if exists pilot_max_quotes;

drop function if exists public.approve_quote_draft(uuid, uuid, jsonb);
drop function if exists public.reconcile_quote_budgets(integer);
drop function if exists public.reconcile_quote_reservation(uuid, numeric, text);
drop function if exists public.mark_quote_reservation_unconfirmed(uuid, text);
drop function if exists public.release_quote_budget(uuid, text);
drop function if exists public.settle_quote_budget(uuid, numeric, bigint, bigint);
drop function if exists public.settle_quote_budget(uuid, numeric, numeric, bigint, bigint);
drop function if exists public.quote_org_budget_report(uuid, timestamptz);
drop function if exists public.quote_expire_job_reservations(uuid, text);
drop function if exists public.reserve_quote_budget(uuid, numeric);
drop function if exists public.quote_org_month_spend(uuid, timestamptz);
drop function if exists public.claim_quote_job(uuid, text, integer);
drop function if exists public.claim_next_quote_job(text, integer, integer);
drop function if exists public.claim_next_quote_job(text, integer);

drop table if exists public.quote_budget_reservations;
drop table if exists public.product_price_cache;
drop table if exists public.quote_org_limits;
drop table if exists public.quote_events;
drop table if exists public.quote_commercial;
drop table if exists public.quote_draft_media;
drop table if exists public.quote_labor_plan;
drop table if exists public.quote_item_options;
drop table if exists public.quote_items;
drop table if exists public.quote_drafts;
drop table if exists public.quote_analysis_jobs;
drop table if exists public.quote_rate_cards;

drop function if exists public.quote_children_guard_approved();
drop function if exists public.quote_drafts_guard_approved();
drop function if exists public.quote_draft_visible_to_caller(uuid, uuid);
drop function if exists public.quote_set_updated_at();

alter table public.units drop column if exists quote_ai_team_mode;
commit;
