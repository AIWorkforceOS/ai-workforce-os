-- ============================================================
-- AI Workforce OS — Migration 47: fatura consolidada a partir de
-- serviços avulsos pendentes
--
-- Pedido do dono do produto: hoje, faturar N serviços avulsos do
-- mesmo cliente (ex.: 10 execuções de $80) exige gerar N faturas
-- individuais (botão "Gerar fatura" por linha em service_records) e
-- DEPOIS consolidá-las na seção "Consolidar faturas em aberto"
-- (migration 045) — dois passos, sem visibilidade do total antes de
-- gerar. Esta migration fecha o caminho direto: agrupa os
-- service_records ainda não faturados por cliente, mostra o total a
-- cobrar / a pagar à equipe / margem, e gera UMA fatura já com o
-- valor cheio.
--
--   service_records.invoice_id — link direto do lançamento para a
--     fatura que o cobriu (individual OU consolidada). Sem essa
--     coluna não dava pra saber quais lançamentos já foram faturados
--     quando uma fatura cobre vários registros de uma vez (o link
--     antigo invoices.service_record_id é 1:1, insuficiente aqui).
--     Nunca deletamos o service_record — só vinculamos, mesmo
--     princípio de invoices.consolidated_into_id da migration 045.
--
--   generate_service_records_invoice() — mesma receita de
--     consolidate_invoices() (migration 045): security definer,
--     autorização manual (can_access_unit + is_org_admin), atômica,
--     grava o detalhamento por serviço em consolidated_items (jsonb,
--     já usado no e-mail/WhatsApp/SMS da fatura — mesma transparência
--     que a consolidação de faturas já dá). Só aceita service_records
--     do mesmo cliente/unidade que ainda não têm invoice_id, evitando
--     fatura duplicada.
-- ============================================================

alter table service_records
  add column if not exists invoice_id uuid references invoices(id) on delete set null;

comment on column service_records.invoice_id is
  'Fatura (individual ou consolidada) que já cobriu este lançamento. Null = avulso pendente de fatura. Preenchido por generate_service_records_invoice() ou ao gerar fatura individual pela linha — nunca aponta para mais de uma fatura ao mesmo tempo, então nunca cobra o mesmo serviço duas vezes.';

create index if not exists service_records_invoice_idx on service_records(invoice_id);

-- Backfill: lançamentos que já tinham sido faturados individualmente
-- antes desta migration (via invoices.service_record_id) não podem
-- reaparecer como "pendentes" na tela nova.
update service_records sr
  set invoice_id = i.id
  from invoices i
  where i.service_record_id = sr.id
    and sr.invoice_id is null;

-- ------------------------------------------------------------
-- generate_service_records_invoice: soma N service_records avulsos
-- (mesmo cliente, ainda não faturados) numa fatura nova e marca os
-- originais com invoice_id. Atômica.
-- ------------------------------------------------------------
create or replace function public.generate_service_records_invoice(
  p_unit_id uuid,
  p_customer_id uuid,
  p_service_record_ids uuid[],
  p_currency text,
  p_due_date date default null,
  p_notes text default null
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
        amount, currency, due_date, status, notes, consolidated_items
      ) values (
        v_org_id, p_unit_id, p_customer_id, v_number,
        v_count || ' serviços consolidados',
        v_total, p_currency, p_due_date, 'draft', p_notes, v_items
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

grant execute on function public.generate_service_records_invoice(uuid, uuid, uuid[], text, date, text) to authenticated;
