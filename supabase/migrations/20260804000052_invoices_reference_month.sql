-- ============================================================
-- AI Workforce OS — Migration 52: mês de referência das faturas
--
-- Pedido do dono do produto: a tela de Operação (migration 030) ganha
-- um seletor de mês/ano pra não misturar os lançamentos de julho com
-- os de agosto/2026, que ele está prestes a começar a lançar.
--
-- service_records já tem um campo natural de "mês de referência":
-- service_date (dia da execução do serviço) — não precisa de coluna
-- nova.
--
-- invoices não tinha um campo equivalente e os dois candidatos óbvios
-- não servem:
--   - created_at é o timestamp real de criação (auditoria) — e a
--     numeração sequencial de fatura (insertInvoice() no client,
--     consolidate_invoices() e generate_service_records_invoice())
--     usa created_at pra achar o próximo número, então retroagi-lo
--     pra "encaixar" numa fatura no mês selecionado quebraria a
--     numeração.
--   - due_date é o vencimento do pagamento — pode cair em qualquer
--     mês futuro, sem relação com o mês operacional do lançamento
--     (nem sempre é preenchido).
--
-- Por isso: nova coluna invoices.reference_month (sempre dia 1 do
-- mês) — decide a qual "gaveta" mensal a fatura pertence na tela de
-- Operação, independente de quando foi de fato criada ou de quando
-- vence. Default/backfill = mês de created_at, então as faturas já
-- existentes (todas de julho/2026, segundo o dono do produto)
-- continuam em julho sem intervenção manual.
-- ============================================================

alter table invoices
  add column if not exists reference_month date;

update invoices
  set reference_month = date_trunc('month', created_at)::date
  where reference_month is null;

alter table invoices
  alter column reference_month set default date_trunc('month', now())::date,
  alter column reference_month set not null;

comment on column invoices.reference_month is
  'Mês operacional (sempre dia 1) ao qual a fatura pertence na tela de Operação — independente de created_at (timestamp real de criação, usado pra numeração sequencial de invoice_number) e de due_date (vencimento do pagamento, pode cair em outro mês). Default/backfill = mês de created_at; definido explicitamente pelo mês selecionado na UI ao criar.';

create index if not exists invoices_unit_reference_month_idx on invoices(unit_id, reference_month);

-- ------------------------------------------------------------
-- consolidate_invoices / generate_service_records_invoice: ganham
-- p_reference_month (novo parâmetro, no fim da lista, com default —
-- CREATE OR REPLACE FUNCTION exige isso pra continuar sendo a mesma
-- função e preservar grants/OID) pra a fatura gerada nascer no mês que
-- o usuário está navegando na tela de Operação, não sempre no mês
-- corrente do servidor.
-- ------------------------------------------------------------
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
    ) order by created_at)
  into v_count, v_total, v_due_date, v_items
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
        coalesce(p_reference_month, date_trunc('month', now())::date)
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
    ) order by service_date)
  into v_count, v_total, v_items
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
        coalesce(p_reference_month, date_trunc('month', now())::date)
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
