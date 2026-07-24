-- ============================================================
-- AI Workforce OS — Migration 38: AI Receptionist ligado a canal real
--
-- prompt.ts (migration 024) já deixava documentado que a Fase 1 do
-- Receptionist não tinha canal de conversa de verdade — só o sandbox
-- de teste. Esta migration é a fundação de dados dessa fase seguinte:
-- WhatsApp/SMS/e-mail passam a ser roteados pra ela (lib/inbound-
-- router.ts) sempre que o remetente bate com um customers.phone/email
-- já cadastrado na unidade.
--
--   customer_messages — espelha candidate_messages (migration 008):
--   histórico de conversa por cliente, independente de conversations
--   (que é escopo de leads/vendas). channel inclui 'sms' porque,
--   diferente do Recruiter (só whatsapp/email), o Receptionist herda
--   o canal de telefone configurado da unidade (units.messaging_channel,
--   que pode ser sms — ver lib/channels/messaging-channel.ts).
--
-- RLS: mesma receita das migrations 008/024 — leitura com
-- can_access_unit(unit_id); escrita humana com can_access_unit +
-- is_org_admin(); o motor de conversa roda com service role, que
-- ignora RLS.
-- ============================================================

create table if not exists customer_messages (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references customers(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'sms', 'email')),
  direction text not null check (direction in ('outbound', 'inbound')),
  content text not null,
  template_key text,
  external_message_id text,
  status text not null default 'sent' check (status in ('sent', 'delivered', 'read', 'failed')),
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists customer_messages_customer_idx on customer_messages(customer_id, sent_at);
create index if not exists customer_messages_unit_sent_idx on customer_messages(unit_id, direction, sent_at);

alter table customer_messages enable row level security;

drop policy if exists customer_messages_select on customer_messages;
create policy customer_messages_select on customer_messages
  for select using (public.can_access_unit(unit_id));

drop policy if exists customer_messages_write on customer_messages;
create policy customer_messages_write on customer_messages
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());
