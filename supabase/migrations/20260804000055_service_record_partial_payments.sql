-- ============================================================
-- AI Workforce OS — Migration 55: pagamento parcial à equipe +
-- ledger de auditoria por ordem de serviço
--
-- Pedido literal do dono do produto sobre a tela de Operação
-- (service-operations-panel.tsx): "a equipe tbm precisa ter a opção
-- de pagar uma parte, mostrar o quanto foi pago, quais ordem e
-- serviços foram pagos, o que ainda falta a pagar etc, cada
-- funcionario precisa ter essa função, tudo precisa funcionar em
-- perfeita sintonia." Exemplo dado: ordem 132617, cobrado $200, devido
-- a Murilo $80 — precisa poder marcar essa ordem como paga parcial ou
-- total e o dashboard sempre mostrar pago/restante corretos.
--
-- Hoje service_records.payment_status é binário (pending/paid) sem
-- nenhum registro de QUANTO foi pago nem QUANDO — "marcar pago" é um
-- boolean sem histórico.
--
-- Modelagem escolhida (documentando o porquê, como pedido):
--
--   service_records.amount_paid_to_employee — total já pago ao
--     profissional por este lançamento. É um rollup, não a fonte de
--     verdade: nunca é escrito diretamente por UPDATE do cliente, só
--     recalculado por trigger a partir da tabela de ledger abaixo
--     (garante que ele nunca pode ficar fora de sincronia com o
--     histórico — a mesma preocupação de "sempre bater" que motivou
--     esta migration).
--
--   service_records.payment_status ganha o valor 'partial' e passa a
--     ser 100% DERIVADO (trigger BEFORE INSERT/UPDATE em
--     service_records), nunca mais confiável a partir do que o
--     cliente manda — antes o app setava payment_status direto num
--     UPDATE; agora isso é ignorado e recalculado a partir de
--     amount_due/amount_paid_to_employee toda vez que a linha muda.
--
--   service_record_payments — ledger append-only: uma linha por
--     transação de pagamento (ou estorno, com amount negativo — nunca
--     deletamos/editamos uma linha existente, uma correção é sempre
--     uma nova linha). É a resposta a "quais ordens e serviços foram
--     pagos, quando e quanto" — uma coluna sozinha (amount_paid_to_
--     employee) não guarda ISSO, só o total atual. Optamos pela
--     tabela de histórico (mais robusta, como sugerido) em vez de só
--     a coluna porque o dono do produto pediu auditoria explícita, e
--     esta tela já foi fonte de 2 bugs de confiança anteriores
--     (migrations 052/054) — não dá pra economizar aqui.
--
--   register_service_record_payment() — única porta de entrada para
--     mexer no saldo pago de um lançamento (parcial, total, ou
--     estorno com amount negativo). security definer, mesma receita
--     de autorização de consolidate_invoices/generate_service_records_
--     invoice. Trava a linha (FOR UPDATE), valida que o saldo nunca
--     fica negativo nem excede amount_due, insere a linha no ledger —
--     o trigger cuida do resto.
-- ============================================================

alter table service_records
  add column if not exists amount_paid_to_employee numeric(12,2) not null default 0
    check (amount_paid_to_employee >= 0);

comment on column service_records.amount_paid_to_employee is
  'Total já pago ao profissional por este lançamento — sempre igual a SUM(service_record_payments.amount) para este service_record_id. Rollup mantido por trigger (sync_service_record_payment_totals); nunca escrito diretamente pelo cliente, só via register_service_record_payment().';

alter table service_records
  drop constraint if exists service_records_payment_status_check;
alter table service_records
  add constraint service_records_payment_status_check
    check (payment_status in ('pending', 'partial', 'paid'));

comment on column service_records.payment_status is
  'Derivado (nunca escrito diretamente) a partir de amount_due/amount_paid_to_employee pelo trigger service_records_derive_payment_status: pending (nada pago), partial (pago > 0 e < devido), paid (pago >= devido). Sem valor a pagar definido (amount_due null/0) fica pending, a menos que já tenha algum pagamento registrado.';

-- Defesa extra: mesmo uma edição direta de amount_due (fora da RPC de
-- pagamento, ex.: corrigir o lançamento depois de já ter pagamento
-- parcial registrado) nunca pode deixar o pago > devido.
alter table service_records
  drop constraint if exists service_records_paid_not_exceeds_due;
alter table service_records
  add constraint service_records_paid_not_exceeds_due
    check (amount_due is null or amount_paid_to_employee <= amount_due);

-- ------------------------------------------------------------
-- Ledger append-only de pagamentos por ordem de serviço
-- ------------------------------------------------------------
create table if not exists service_record_payments (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  service_record_id uuid not null references service_records(id) on delete cascade,
  -- amount <> 0: uma linha é sempre um evento de pagamento (positivo) ou
  -- estorno/correção (negativo) — nunca um "nada aconteceu".
  amount numeric(12,2) not null check (amount <> 0),
  note text,
  created_at timestamptz not null default now()
);

comment on table service_record_payments is
  'Ledger append-only de pagamentos à equipe por ordem de serviço (migration 055) — nunca editado nem deletado; correções e estornos entram como nova linha (amount negativo). Fonte de verdade de "quais ordens/serviços foram pagos, quando e quanto"; service_records.amount_paid_to_employee é sempre o SUM(amount) destas linhas, mantido em sincronia por trigger.';

create index if not exists service_record_payments_record_idx on service_record_payments(service_record_id, created_at);
create index if not exists service_record_payments_unit_idx on service_record_payments(unit_id, created_at);

alter table service_record_payments enable row level security;

drop policy if exists service_record_payments_select on service_record_payments;
create policy service_record_payments_select on service_record_payments
  for select using (public.can_access_unit(unit_id));

-- Sem policy de insert/update/delete para authenticated: a única porta
-- de entrada é register_service_record_payment() (security definer,
-- roda com privilégio de dono da função e faz sua própria checagem de
-- can_access_unit + is_org_admin — mesma receita de consolidate_invoices).

-- ------------------------------------------------------------
-- Trigger: mantém amount_paid_to_employee e payment_status de
-- service_records sempre em sincronia com o ledger.
-- ------------------------------------------------------------
create or replace function public.sync_service_record_payment_totals() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_id uuid;
  v_total numeric(12,2);
  v_due numeric(12,2);
  v_last_paid_at timestamptz;
begin
  v_record_id := coalesce(new.service_record_id, old.service_record_id);

  select coalesce(sum(amount), 0) into v_total
    from service_record_payments where service_record_id = v_record_id;

  select amount_due into v_due from service_records where id = v_record_id;

  if v_total < 0 then
    raise exception 'Total pago ao profissional não pode ficar negativo (saldo resultante: %).', v_total;
  end if;
  if v_due is not null and v_total > v_due then
    raise exception 'Total pago (%) não pode exceder o valor devido ao profissional (%).', v_total, v_due;
  end if;

  select max(created_at) into v_last_paid_at
    from service_record_payments
    where service_record_id = v_record_id and amount > 0;

  update service_records
    set amount_paid_to_employee = v_total,
        payment_status = case
          when v_total <= 0 then 'pending'
          when v_due is not null and v_due > 0 and v_total >= v_due then 'paid'
          else 'partial'
        end,
        paid_at = case when v_total > 0 then v_last_paid_at else null end
    where id = v_record_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists service_record_payments_sync on service_record_payments;
create trigger service_record_payments_sync
  after insert or update or delete on service_record_payments
  for each row execute function public.sync_service_record_payment_totals();

-- ------------------------------------------------------------
-- Trigger: blinda payment_status contra escrita direta do cliente —
-- qualquer INSERT/UPDATE em service_records recalcula o status a
-- partir de amount_due/amount_paid_to_employee, ignorando o que foi
-- enviado no payload (mesmo em edição manual do lançamento, que pode
-- mudar amount_due depois de já existir pagamento parcial).
-- ------------------------------------------------------------
create or replace function public.service_records_derive_payment_status() returns trigger
language plpgsql
as $$
begin
  if new.amount_paid_to_employee is null or new.amount_paid_to_employee <= 0 then
    new.payment_status := 'pending';
    new.paid_at := null;
  elsif new.amount_due is not null and new.amount_due > 0 and new.amount_paid_to_employee >= new.amount_due then
    new.payment_status := 'paid';
  else
    new.payment_status := 'partial';
  end if;
  return new;
end;
$$;

drop trigger if exists service_records_derive_payment_status on service_records;
create trigger service_records_derive_payment_status
  before insert or update on service_records
  for each row execute function public.service_records_derive_payment_status();

-- ------------------------------------------------------------
-- register_service_record_payment: única forma de registrar um
-- pagamento (parcial ou total) ou um estorno (amount negativo) a um
-- lançamento. Atômica, trava a linha, nunca deixa o saldo sair de
-- [0, amount_due].
-- ------------------------------------------------------------
create or replace function public.register_service_record_payment(
  p_service_record_id uuid,
  p_amount numeric,
  p_note text default null
) returns service_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit_id uuid;
  v_org_id uuid;
  v_due numeric(12,2);
  v_paid numeric(12,2);
  v_result service_records;
begin
  select unit_id, org_id, amount_due, amount_paid_to_employee
    into v_unit_id, v_org_id, v_due, v_paid
    from service_records
    where id = p_service_record_id
    for update;

  if v_unit_id is null then
    raise exception 'lançamento não encontrado';
  end if;
  if not public.can_access_unit(v_unit_id) or not public.is_org_admin() then
    raise exception 'sem permissão para registrar pagamento nesta unidade';
  end if;
  if p_amount = 0 then
    raise exception 'informe um valor de pagamento diferente de zero';
  end if;
  if p_amount > 0 then
    if v_due is null or v_due <= 0 then
      raise exception 'este lançamento não tem valor a pagar ao profissional definido';
    end if;
    if (v_paid + p_amount) > v_due then
      raise exception 'valor informado (%) excede o saldo devido (%)', p_amount, (v_due - v_paid);
    end if;
  else
    if (v_paid + p_amount) < 0 then
      raise exception 'estorno (%) maior que o total já pago (%)', -p_amount, v_paid;
    end if;
  end if;

  insert into service_record_payments (org_id, unit_id, service_record_id, amount, note)
    values (v_org_id, v_unit_id, p_service_record_id, p_amount, p_note);

  select * into v_result from service_records where id = p_service_record_id;
  return v_result;
end;
$$;

grant execute on function public.register_service_record_payment(uuid, numeric, text) to authenticated;

-- ------------------------------------------------------------
-- Backfill: lançamentos já marcados 'paid' antes desta migration não
-- tinham amount_paid_to_employee — sem isso, o trigger de escrita
-- acima os rebaixaria pra 'pending' na próxima edição. Cada um vira
-- uma linha no ledger (amount = amount_due, com nota explicando a
-- origem) para preservar o estado e alimentar o rollup.
-- ------------------------------------------------------------
insert into service_record_payments (org_id, unit_id, service_record_id, amount, note, created_at)
select org_id, unit_id, id, amount_due,
  'Migração automática (055) — lançamento já estava marcado como pago antes do controle de pagamento parcial existir.',
  coalesce(paid_at, updated_at)
from service_records
where payment_status = 'paid'
  and amount_due is not null
  and amount_due > 0;
