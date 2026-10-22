-- Migration 102 — Faturamento por cliente (Facility). ADITIVA; NÃO aplicada até autorização.
--  * service_records.due_date: vencimento de CADA ordem (o administrador informa ao finalizar; ex.: Net 15 = encerramento + 15 dias).
--  * client_company_profiles.payment_terms_days: prazo padrão do cliente (15, 30, 45, 60… livre) para sugerir o vencimento.
--  * generate_client_invoice(): UMA fatura por cliente, reunindo as ordens dele (de qualquer loja/cadastro vinculado ao cliente).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.service_records add column if not exists due_date date;
comment on column public.service_records.due_date is 'Vencimento da ordem (data de envio/cobrança da invoice). Informado pelo administrador ao finalizar a ordem.';
create index if not exists service_records_unit_due_idx on public.service_records (unit_id, due_date) where invoice_id is null and due_date is not null;

alter table public.client_company_profiles add column if not exists payment_terms_days integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_company_profiles_terms_range') then
    alter table public.client_company_profiles add constraint client_company_profiles_terms_range check (payment_terms_days is null or (payment_terms_days between 0 and 365));
  end if;
end $$;

create or replace function public.generate_client_invoice(
  p_unit_id uuid,
  p_client_company text,
  p_service_record_ids uuid[],
  p_currency text default 'USD',
  p_due_date date default null,
  p_notes text default null
) returns invoices
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org_id uuid;
  v_billing uuid;
  v_count int;
  v_total numeric(12,2);
  v_items jsonb;
  v_month date;
  v_max_due date;
  v_next int;
  v_number text;
  v_new invoices;
  v_attempt int;
  v_client text := lower(btrim(coalesce(p_client_company, '')));
begin
  if not public.can_access_unit(p_unit_id) or not public.is_org_admin() then
    raise exception 'sem permissão para gerar fatura desta unidade';
  end if;
  if v_client = '' then
    raise exception 'Informe o cliente da fatura.';
  end if;
  if p_service_record_ids is null or array_length(p_service_record_ids, 1) is null or array_length(p_service_record_ids, 1) < 1 then
    raise exception 'Selecione ao menos uma ordem para faturar.';
  end if;

  select org_id into v_org_id from units where id = p_unit_id;
  if v_org_id is null then
    raise exception 'unidade não encontrada';
  end if;

  -- Quem recebe a fatura: o cadastro com o nome do próprio cliente; na falta, o primeiro cadastro vinculado a ele.
  select id into v_billing
  from customers
  where unit_id = p_unit_id and lower(btrim(coalesce(client_company, ''))) = v_client
  order by (lower(btrim(name)) = v_client) desc, created_at
  limit 1;
  if v_billing is null then
    raise exception 'Este cliente ainda não tem cadastro de cobrança nesta unidade.';
  end if;

  select count(*), sum(r.amount_charged),
    jsonb_agg(jsonb_build_object(
      'invoice_id', r.id,
      'invoice_number', to_char(r.service_date, 'DD/MM/YYYY'),
      'description', coalesce(r.description, 'Serviço prestado'),
      'amount', r.amount_charged,
      'due_date', r.due_date
    ) order by r.service_date, r.created_at),
    mode() within group (order by date_trunc('month', r.service_date)::date),
    max(r.due_date)
  into v_count, v_total, v_items, v_month, v_max_due
  from service_records r
  join customers c on c.id = r.customer_id
  where r.id = any(p_service_record_ids)
    and r.unit_id = p_unit_id
    and r.invoice_id is null
    and r.amount_charged is not null
    and lower(btrim(coalesce(c.client_company, ''))) = v_client;

  if v_count is distinct from array_length(p_service_record_ids, 1) then
    raise exception 'Uma ou mais ordens não estão elegíveis (já faturadas, de outro cliente ou sem valor cobrado).';
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
        v_org_id, p_unit_id, v_billing, v_number,
        v_count || ' ordem(ns) — ' || btrim(p_client_company),
        v_total, coalesce(p_currency, 'USD'), coalesce(p_due_date, v_max_due), 'draft', p_notes, v_items,
        coalesce(v_month, date_trunc('month', now())::date)
      )
      returning * into v_new;
      exit;
    exception when unique_violation then
      if v_attempt = 5 then
        raise exception 'Não foi possível gerar um número de fatura. Tente de novo.';
      end if;
    end;
  end loop;

  update service_records set invoice_id = v_new.id where id = any(p_service_record_ids);
  return v_new;
end;
$$;
