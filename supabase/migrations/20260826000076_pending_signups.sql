-- ============================================================
-- Pending signups (2026-08-26) — pagamento obrigatório ANTES da conta
-- existir.
--
-- Decisão do produto (2026-08-26, revertendo a de 19/08 em
-- 20260819000065_payment_provider_architecture.sql): o checkout
-- deixa de criar a conta instantaneamente e cobrar depois,
-- best-effort. Agora a etapa 2 do checkout manda o cliente pro
-- checkout hospedado da processadora (cartão digitado só lá, nunca no
-- nosso servidor) e SÓ o webhook de pagamento aprovado provisiona a
-- conta de verdade (ver lib/checkout/provision.ts e
-- lib/payments/webhook-handler.ts). Sem pagamento aprovado, não existe
-- organization/unit/user nenhum — pending_signups é só um rascunho
-- temporário até isso acontecer (ou nunca acontecer, e ficar órfão).
-- ============================================================

create table if not exists pending_signups (
  id uuid primary key default uuid_generate_v4(),
  company text not null,
  name text not null,
  email text not null,
  phone text,
  plan text not null,
  currency text not null,
  region text not null,
  locale text not null,
  amount numeric not null,
  payment_method text not null default 'card',
  provider text not null,               -- 'asaas' | 'stripe'
  provider_customer_ref text,
  provider_charge_ref text,
  terms_version text not null,
  privacy_version text not null,
  accept_ip text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'expired')),
  org_id uuid references organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table pending_signups is
  'Rascunho de cadastro entre "cliente preencheu os dados" e "pagamento aprovado". Provisionado em organizations/units/users só quando o webhook de pagamento confirma o 1º pagamento — ver lib/checkout/provision.ts. status=expired é reservado pra uma limpeza futura (ainda não existe cron pra isso).';

create index if not exists pending_signups_provider_customer_idx on pending_signups(provider, provider_customer_ref);
create index if not exists pending_signups_provider_charge_idx on pending_signups(provider, provider_charge_ref);
create index if not exists pending_signups_status_idx on pending_signups(status);

alter table pending_signups enable row level security;

drop policy if exists pending_signups_all on pending_signups;
create policy pending_signups_all on pending_signups
  for all using (public.is_super_admin())
  with check (public.is_super_admin());
