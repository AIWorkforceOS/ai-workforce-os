-- ============================================================
-- AI Workforce OS — Migration 30: Operação de Serviços
--
-- Transforma o Alizo em gestão real de empresas de serviços de
-- campo (ex.: housecleaning): equipe humana com especialidade e
-- valor a pagar, endereço + aviso "a caminho" no agendamento,
-- registro de serviços executados (base do controle de pagamento
-- por técnico) e faturas enviadas por e-mail ao cliente final.
--
--   employees.specialty / default_pay / default_pay_type —
--     função/especialidade do colaborador e o valor padrão que a
--     empresa paga a ele por serviço executado. default_pay_type:
--       per_service — valor fixo por serviço;
--       per_hour    — valor × horas do atendimento;
--       per_day     — diária (sugestão não é calculada por serviço);
--       percent     — % do valor cobrado do cliente.
--     São só o DEFAULT de sugestão — o valor real de cada execução
--     vive em service_records.amount_due e é sempre editável.
--
--   appointments.address — endereço onde o serviço será prestado
--     (campo do agendamento, não do cliente: um mesmo cliente pode
--     ter atendimentos em endereços diferentes). Pré-preenchido na
--     UI com customers.address.
--   appointments.on_my_way_sent_at — carimbo de idempotência do
--     aviso "estamos a caminho" (mesmo padrão de reminder_sent_at).
--
--   service_records — "esse profissional executou esse serviço
--     nesse dia, cobramos X do cliente e devemos Y a ele". É a
--     folha operacional, não folha de pagamento fiscal (sem
--     impostos/encargos). appointment_id é opcional (serviço pode
--     ser lançado sem ter passado pela agenda) e único quando
--     presente (concluir um agendamento nunca duplica o registro).
--
--   invoices — fatura/recibo do serviço para o cliente final,
--     enviada por e-mail (Resend). Sem gateway de pagamento nesta
--     fase: registra o valor cobrado e o ciclo draft→sent→paid.
--     invoice_number é gerado pela aplicação; unicidade por unidade.
--
-- RLS: mesma receita das migrations 007/013/024/026 — leitura com
-- can_access_unit(unit_id); escrita com can_access_unit + is_org_admin().
-- ============================================================

-- ------------------------------------------------------------
-- EMPLOYEES: especialidade + valor padrão a pagar
-- ------------------------------------------------------------
alter table employees
  add column if not exists specialty text,
  add column if not exists default_pay numeric(12,2),
  add column if not exists default_pay_type text not null default 'per_service'
    check (default_pay_type in ('per_service', 'per_hour', 'per_day', 'percent'));

comment on column employees.specialty is
  'Função/especialidade operacional (ex.: Limpeza residencial, Deep clean). Livre, definida pela empresa.';
comment on column employees.default_pay is
  'Valor padrão a pagar ao colaborador por serviço executado, interpretado conforme default_pay_type. Null = sem padrão (preencher manualmente em service_records).';

-- ------------------------------------------------------------
-- APPOINTMENTS: endereço do serviço + carimbo do aviso "a caminho"
-- ------------------------------------------------------------
alter table appointments
  add column if not exists address text,
  add column if not exists on_my_way_sent_at timestamptz;

comment on column appointments.address is
  'Endereço onde o serviço será prestado (serviços de campo). Pré-preenchido na UI com customers.address, mas editável por agendamento.';
comment on column appointments.on_my_way_sent_at is
  'Quando o aviso "estamos a caminho" foi enviado ao cliente (idempotência, mesmo padrão de reminder_sent_at).';

-- ------------------------------------------------------------
-- TABELA: service_records (serviços executados + valores)
-- ------------------------------------------------------------
create table if not exists service_records (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  service_id uuid references services(id) on delete set null,
  service_date date not null,
  description text,
  amount_charged numeric(12,2),
  amount_due numeric(12,2),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column service_records.amount_charged is 'Valor cobrado do cliente final por este serviço.';
comment on column service_records.amount_due is 'Valor a pagar ao profissional por este serviço.';

create index if not exists service_records_unit_date_idx on service_records(unit_id, service_date);
create index if not exists service_records_employee_idx on service_records(employee_id);
create index if not exists service_records_unit_payment_idx on service_records(unit_id, payment_status);
-- Concluir o mesmo agendamento duas vezes nunca duplica o lançamento.
create unique index if not exists service_records_appointment_uidx
  on service_records(appointment_id) where appointment_id is not null;

create trigger service_records_updated_at before update on service_records
  for each row execute function update_updated_at();

alter table service_records enable row level security;

drop policy if exists service_records_select on service_records;
create policy service_records_select on service_records
  for select using (public.can_access_unit(unit_id));

drop policy if exists service_records_write on service_records;
create policy service_records_write on service_records
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

-- ------------------------------------------------------------
-- TABELA: invoices (faturas/recibos para o cliente final)
-- ------------------------------------------------------------
create table if not exists invoices (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  service_record_id uuid references service_records(id) on delete set null,
  invoice_number text not null,
  description text not null,
  amount numeric(12,2) not null,
  currency text not null default 'BRL',
  due_date date,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'cancelled')),
  sent_to_email text,
  sent_at timestamptz,
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column invoices.notes is
  'Texto livre incluído no e-mail (ex.: instruções de pagamento — Zelle, PIX, link). O Alizo não processa o pagamento da fatura nesta fase.';

create unique index if not exists invoices_unit_number_uidx on invoices(unit_id, invoice_number);
create index if not exists invoices_unit_status_idx on invoices(unit_id, status);
create index if not exists invoices_customer_idx on invoices(customer_id);

create trigger invoices_updated_at before update on invoices
  for each row execute function update_updated_at();

alter table invoices enable row level security;

drop policy if exists invoices_select on invoices;
create policy invoices_select on invoices
  for select using (public.can_access_unit(unit_id));

drop policy if exists invoices_write on invoices;
create policy invoices_write on invoices
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());
