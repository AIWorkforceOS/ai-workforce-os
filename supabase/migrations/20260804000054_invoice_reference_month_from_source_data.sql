-- ============================================================
-- AI Workforce OS — Migration 54: reference_month derivado dos
-- lançamentos de origem, não do dia em que a fatura foi gerada
--
-- Bug real encontrado em produção pelo dono do produto: INV-0001
-- (id d3ae8ee6-c247-4fc9-9d74-4559e045d4ed) consolida 43 service_records
-- executados entre 20/07 e 31/07/2026, mas a fatura em si foi GERADA em
-- 02/08/2026 — dois dias depois, já em agosto. Como a migration 052
-- fazia reference_month cair no default (mês de created_at) quando não
-- passado explicitamente, e o app na época nem tinha o parâmetro ainda,
-- essa fatura nasceu com reference_month=2026-08-01 mesmo sendo, na
-- prática, 100% trabalho de julho.
--
-- A migration 052 (mesma sessão, mais cedo) tentou corrigir isso fazendo
-- o CLIENTE passar p_reference_month = mês selecionado na tela. Isso
-- ainda tem uma falha: se o usuário consolida serviços/faturas de um mês
-- enquanto a tela mostra outro (ex.: faturando pendências de julho na
-- visão "Todo o histórico", ou depois de navegar pra agosto sem perceber
-- que ainda há registros de julho sem fatura), a fatura nasce no mês que
-- a TELA mostra, não no mês real do trabalho — o mesmíssimo tipo de bug.
--
-- Fix definitivo: as duas RPCs que geram fatura a partir de outros
-- registros passam a DERIVAR reference_month dos próprios dados sendo
-- consolidados (o mês mais comum entre os service_records ou as
-- invoices de origem — mode(), com empate resolvido por ordem natural),
-- em vez de confiar em qual mês o cliente/tela informou. p_reference_month
-- continua existindo como override manual explícito (ex.: ferramenta de
-- correção futura), mas o app não passa mais esse parâmetro nessas duas
-- chamadas — ver service-operations-panel.tsx.
--
-- Fatura manual avulsa (sem lançamento de origem, criada direto pela UI)
-- continua usando o mês selecionado na tela — não há outra fonte de
-- verdade possível nesse caso.
-- ============================================================

create or replace function public.consolidate_invoices(
  p_unit_id uuid,
  p_customer_id uuid,
  p_invoice_ids uuid[],
  p_notes text default null,
  p_reference_month date default null
) returns invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_currency text;
  v_total numeric(12,2);
  v_due_date date;
  v_items jsonb;
  v_count int;
  v_derived_month date;
  v_next int;
  v_number text;
  v_new invoices;
  v_attempt int;
begin
  if not public.can_access_unit(p_unit_id) or not public.is_org_admin() then
    raise exception 'sem permissão para consolidar faturas desta unidade';
  end if;

  if p_invoice_ids is null or array_length(p_invoice_ids, 1) is null or array_length(p_invoice_ids, 1) < 2 then
    raise exception 'Selecione ao menos duas faturas para consolidar.';
  end if;

  select count(*), sum(amount), min(due_date),
    jsonb_agg(jsonb_build_object(
      'invoice_id', id,
      'invoice_number', invoice_number,
      'description', description,
      'amount', amount,
      'due_date', due_date
    ) order by created_at),
    mode() within group (order by reference_month)
  into v_count, v_total, v_due_date, v_items, v_derived_month
  from invoices
  where id = any(p_invoice_ids)
    and unit_id = p_unit_id
    and customer_id = p_customer_id
    and status in ('draft', 'sent');

  if v_count is distinct from array_length(p_invoice_ids, 1) then
    raise exception 'Uma ou mais faturas não estão elegíveis para consolidação (já pagas, canceladas ou já consolidadas).';
  end if;

  select org_id, currency into v_org_id, v_currency from invoices where id = p_invoice_ids[1];

  for v_attempt in 1..5 loop
    select coalesce(max((regexp_match(invoice_number, '^INV-(\d+)$'))[1]::int), 0) + 1
      into v_next
      from invoices where unit_id = p_unit_id;
    v_number := 'INV-' || lpad(v_next::text, 4, '0');
    begin
      insert into invoices (
        org_id, unit_id, customer_id, invoice_number, description,
        amount, currency, due_date, status, notes, consolidated_items, reference_month
      ) values (
        v_org_id, p_unit_id, p_customer_id, v_number,
        v_count || ' cobranças consolidadas',
        v_total, v_currency, v_due_date, 'draft', p_notes, v_items,
        coalesce(p_reference_month, v_derived_month, date_trunc('month', now())::date)
      )
      returning * into v_new;
      exit;
    exception when unique_violation then
      if v_attempt = 5 then
        raise exception 'Não foi possível gerar um número de fatura consolidada. Tente de novo.';
      end if;
    end;
  end loop;

  update invoices
    set status = 'consolidated', consolidated_into_id = v_new.id
    where id = any(p_invoice_ids);

  return v_new;
end;
$$;

grant execute on function public.consolidate_invoices(uuid, uuid, uuid[], text, date) to authenticated;

create or replace function public.generate_service_records_invoice(
  p_unit_id uuid,
  p_customer_id uuid,
  p_service_record_ids uuid[],
  p_currency text,
  p_due_date date default null,
  p_notes text default null,
  p_reference_month date default null
) returns invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_total numeric(12,2);
  v_items jsonb;
  v_count int;
  v_derived_month date;
  v_next int;
  v_number text;
  v_new invoices;
  v_attempt int;
begin
  if not public.can_access_unit(p_unit_id) or not public.is_org_admin() then
    raise exception 'sem permissão para gerar fatura desta unidade';
  end if;

  if p_service_record_ids is null or array_length(p_service_record_ids, 1) is null or array_length(p_service_record_ids, 1) < 1 then
    raise exception 'Selecione ao menos um serviço para faturar.';
  end if;

  select org_id into v_org_id from units where id = p_unit_id;
  if v_org_id is null then
    raise exception 'unidade não encontrada';
  end if;

  select count(*), sum(amount_charged),
    jsonb_agg(jsonb_build_object(
      'invoice_id', id,
      'invoice_number', to_char(service_date, 'DD/MM/YYYY'),
      'description', coalesce(description, 'Serviço prestado'),
      'amount', amount_charged,
      'due_date', null
    ) order by service_date),
    mode() within group (order by date_trunc('month', service_date)::date)
  into v_count, v_total, v_items, v_derived_month
  from service_records
  where id = any(p_service_record_ids)
    and unit_id = p_unit_id
    and customer_id = p_customer_id
    and invoice_id is null
    and amount_charged is not null;

  if v_count is distinct from array_length(p_service_record_ids, 1) then
    raise exception 'Um ou mais serviços não estão elegíveis para faturamento (já faturados, de outro cliente ou sem valor cobrado).';
  end if;

  for v_attempt in 1..5 loop
    select coalesce(max((regexp_match(invoice_number, '^INV-(\d+)$'))[1]::int), 0) + 1
      into v_next
      from invoices where unit_id = p_unit_id;
    v_number := 'INV-' || lpad(v_next::text, 4, '0');
    begin
      insert into invoices (
        org_id, unit_id, customer_id, invoice_number, description,
        amount, currency, due_date, status, notes, consolidated_items, reference_month
      ) values (
        v_org_id, p_unit_id, p_customer_id, v_number,
        v_count || ' serviços consolidados',
        v_total, p_currency, p_due_date, 'draft', p_notes, v_items,
        coalesce(p_reference_month, v_derived_month, date_trunc('month', now())::date)
      )
      returning * into v_new;
      exit;
    exception when unique_violation then
      if v_attempt = 5 then
        raise exception 'Não foi possível gerar um número de fatura. Tente de novo.';
      end if;
    end;
  end loop;

  update service_records
    set invoice_id = v_new.id
    where id = any(p_service_record_ids);

  return v_new;
end;
$$;

grant execute on function public.generate_service_records_invoice(uuid, uuid, uuid[], text, date, text, date) to authenticated;
