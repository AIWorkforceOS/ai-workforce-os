-- ============================================================
-- AI Workforce OS — Migration 45: fatura editável + consolidação
--
-- Fase 2/3 da auditoria interna de confiança do cliente pós-1-mês
-- (fase 1 foi migration 044, sobre badge/aviso/copy — não relacionada).
-- Esta fase fecha dois gaps de faturas:
--
--   1) Fatura editável antes de paga — hoje só o status muda depois
--      de criada; valor/descrição/vencimento ficam travados para
--      sempre. RLS já permitia (invoices_write é "for all" sem
--      restrição por status), então o gap era só de UI — mas
--      adicionamos um trigger de defesa em profundidade: nenhum
--      caminho (UI, API, script) pode alterar valor/descrição/
--      vencimento de uma fatura já paga, porque isso seria reescrever
--      histórico financeiro já quitado.
--
--   2) Fatura consolidada por cliente — hoje cada cobrança gera uma
--      invoice separada. consolidate_invoices() soma N faturas em
--      aberto (draft/sent) do mesmo cliente numa fatura nova, grava o
--      detalhamento em consolidated_items (jsonb, para transparência
--      no e-mail/WhatsApp/SMS) e marca as originais como
--      status='consolidated' + consolidated_into_id (nunca deleta o
--      histórico, só vincula — evita cobrar duas vezes). A função é
--      security definer porque agrega e atualiza várias linhas de
--      uma vez; a autorização é checada manualmente dentro dela com
--      as mesmas regras da RLS (can_access_unit + is_org_admin).
-- ============================================================

-- ------------------------------------------------------------
-- Novos campos: link fatura originada → fatura consolidada, e o
-- detalhamento dos itens que compõem uma fatura consolidada.
-- ------------------------------------------------------------
alter table invoices
  add column if not exists consolidated_into_id uuid references invoices(id) on delete set null,
  add column if not exists consolidated_items jsonb;

comment on column invoices.consolidated_into_id is
  'Preenchido quando esta fatura foi somada a outras numa fatura consolidada (status vira consolidated). Nunca deletamos a original — só vinculamos, para manter o histórico e não cobrar duas vezes.';
comment on column invoices.consolidated_items is
  'Preenchido só na fatura consolidada (a nova): array [{invoice_id, invoice_number, description, amount, due_date}] com o detalhamento das faturas originais que a compõem — usado para transparência no e-mail/WhatsApp/SMS.';

create index if not exists invoices_consolidated_into_idx on invoices(consolidated_into_id);

-- 'consolidated' = fatura original que foi somada a outra; nunca é
-- enviada nem paga diretamente, só existe para manter o histórico.
alter table invoices drop constraint if exists invoices_status_check;
alter table invoices add constraint invoices_status_check
  check (status in ('draft', 'sent', 'paid', 'cancelled', 'consolidated'));

-- ------------------------------------------------------------
-- Defesa em profundidade: fatura paga não pode ter valor, descrição
-- ou vencimento alterados por nenhum caminho (RLS já libera update
-- por ser "for all" sem filtro de status — o trigger é quem trava).
-- ------------------------------------------------------------
create or replace function public.prevent_paid_invoice_financial_edit()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'paid' and (
    new.description is distinct from old.description or
    new.amount is distinct from old.amount or
    new.due_date is distinct from old.due_date
  ) then
    raise exception 'Fatura paga não pode ter valor, descrição ou vencimento alterados.';
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_prevent_paid_financial_edit on invoices;
create trigger invoices_prevent_paid_financial_edit
  before update on invoices
  for each row execute function public.prevent_paid_invoice_financial_edit();

-- ------------------------------------------------------------
-- consolidate_invoices: soma N faturas em aberto do mesmo cliente
-- numa fatura nova (mesma numeração INV-0000 do app) e marca as
-- originais como consolidated. Atômica (função plpgsql = uma
-- transação; qualquer exceção desfaz tudo).
-- ------------------------------------------------------------
create or replace function public.consolidate_invoices(
  p_unit_id uuid,
  p_customer_id uuid,
  p_invoice_ids uuid[],
  p_notes text default null
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
        amount, currency, due_date, status, notes, consolidated_items
      ) values (
        v_org_id, p_unit_id, p_customer_id, v_number,
        v_count || ' cobranças consolidadas',
        v_total, v_currency, v_due_date, 'draft', p_notes, v_items
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

grant execute on function public.consolidate_invoices(uuid, uuid, uuid[], text) to authenticated;
