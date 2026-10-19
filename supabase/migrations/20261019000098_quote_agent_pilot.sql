-- Super Agente de Cotações — migration 098 (ADITIVA; NÃO aplicada até autorização).
-- Piloto MAWI: conversa técnico↔agente, versões revisáveis, avaliação humana do piloto, campos de compra por item
-- e UM job por WO (o teto de US$ 0,60 acumula entre revisões: nenhuma revisão reinicia o orçamento).
-- Segurança de aplicação: falha rápido em vez de travar atrás de transação longa e nunca roda sem limite.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1) Lista de técnicos autorizados no piloto (por funcionário; padrão desligado).
alter table public.employees add column if not exists quote_agent_enabled boolean not null default false;
comment on column public.employees.quote_agent_enabled is 'Técnico autorizado a usar o Super Agente de Cotações (piloto). Só vale com a unidade em modo live.';

-- 2) Dados de compra do item (preço de COMPRA — visível ao técnico). Origem do preço sempre registrada.
alter table public.quote_items add column if not exists supplier text;
alter table public.quote_items add column if not exists product_url text;
alter table public.quote_items add column if not exists price_source text;
alter table public.quote_items add column if not exists price_checked_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quote_items_product_url_https') then
    alter table public.quote_items add constraint quote_items_product_url_https check (product_url is null or product_url ~ '^https://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quote_items_price_source_valid') then
    alter table public.quote_items add constraint quote_items_price_source_valid check (price_source is null or price_source in ('ai_verified', 'ai_estimated', 'manual'));
  end if;
end $$;

-- 3) Um job por WO: o orçamento (US$ 0,60) é da COTAÇÃO inteira, somando diagnóstico, perguntas, revisões e buscas.
--    `rounds` conta as rodadas (resposta do técnico / pedido de revisão) para travar loops.
alter table public.quote_analysis_jobs add column if not exists rounds integer not null default 1;
create unique index if not exists quote_jobs_one_per_appointment on public.quote_analysis_jobs (appointment_id);

-- 4) Conversa técnico ↔ agente (perguntas, respostas, pedidos de revisão). Escrita só pelo service role (rotas de servidor).
create table if not exists public.quote_messages (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  job_id uuid references public.quote_analysis_jobs(id) on delete cascade,
  draft_id uuid references public.quote_drafts(id) on delete set null,
  role text not null check (role in ('agent', 'technician', 'admin', 'system')),
  kind text not null check (kind in ('question', 'answer', 'revision_request', 'note', 'status')),
  body text,
  media jsonb not null default '[]'::jsonb,        -- [{url, kind, uploaded_at}] — fotos já registradas na WO
  questions jsonb not null default '[]'::jsonb,    -- [{id, kind, request_pt}] — o que o agente pede (agrupado)
  answers_to uuid references public.quote_messages(id) on delete set null,
  round integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists quote_messages_appointment_idx on public.quote_messages (appointment_id, created_at);
alter table public.quote_messages enable row level security;
drop policy if exists quote_messages_select on public.quote_messages;
create policy quote_messages_select on public.quote_messages
  for select using (
    public.can_access_unit(unit_id)
    and exists (select 1 from public.appointments a where a.id = quote_messages.appointment_id)
    and public.quote_draft_visible_to_caller(id, job_id)   -- admin sempre; técnico só com o job em modo live
  );

-- 5) Avaliação humana do piloto (SOMENTE ADMIN): acerto do diagnóstico, materiais certos/errados, horas.
create table if not exists public.quote_pilot_reviews (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  draft_id uuid references public.quote_drafts(id) on delete set null,
  diagnosis_verdict text check (diagnosis_verdict in ('correct', 'partial', 'incorrect')),
  diagnosis_confirmed_pt text,               -- diagnóstico confirmado pelo técnico/admin
  materials_correct integer not null default 0 check (materials_correct >= 0),
  materials_incorrect integer not null default 0 check (materials_incorrect >= 0),
  hours_suggested numeric(8,3),
  hours_final numeric(8,3),
  manual_interventions integer not null default 0 check (manual_interventions >= 0),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_pilot_reviews_one_per_appointment unique (appointment_id)
);
alter table public.quote_pilot_reviews enable row level security;
drop policy if exists quote_pilot_reviews_admin_all on public.quote_pilot_reviews;
create policy quote_pilot_reviews_admin_all on public.quote_pilot_reviews
  for all using (public.is_org_admin() and public.can_access_unit(unit_id))
  with check (public.is_org_admin() and public.can_access_unit(unit_id));
drop trigger if exists quote_pilot_reviews_updated_at on public.quote_pilot_reviews;
create trigger quote_pilot_reviews_updated_at before update on public.quote_pilot_reviews
  for each row execute function public.quote_set_updated_at();
