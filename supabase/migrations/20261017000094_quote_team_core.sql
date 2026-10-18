-- Super Agente de Cotações — Fase 2 / migration 094 (ADITIVA; NÃO aplicada até autorização).
-- Núcleo em DUAS CAMADAS separadas (visibilidade financeira):
--   TÉCNICA  (técnico responsável pode ler): quote_drafts, quote_items, quote_item_options, quote_labor_plan, quote_draft_media
--   ADMIN    (técnico NUNCA lê, nem por API direta): quote_analysis_jobs (custos de IA), quote_commercial, quote_events (visibility='admin')
-- Valores monetários em MICRO-DÓLARES (bigint): sem float, sem arredondar no meio do cálculo.
-- quote_labor_plan NÃO tem nenhuma coluna monetária (só técnicos, horas e horas-homem).
-- Segurança de aplicação: falha rápido em vez de travar atrás de transação longa (ex.: sync da Facil-IT) e nunca roda sem limite.
set local lock_timeout = '5s';
set local statement_timeout = '60s';


create or replace function public.quote_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- Trabalhos de análise (fila assíncrona, idempotente, retomável) — ADMIN lê; técnico acompanha só pela rota de servidor
-- ---------------------------------------------------------------
create table if not exists public.quote_analysis_jobs (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'needs_input', 'completed', 'failed', 'cancelled', 'budget_exhausted')),
  stage text not null default 'queued'
    check (stage in ('queued', 'diagnosis', 'materials', 'pricing', 'labor', 'costing', 'audit', 'done')),
  trigger_source text not null default 'save' check (trigger_source in ('save', 'manual', 'reanalyze')),
  mode text not null default 'shadow' check (mode in ('shadow', 'live')),   -- shadow = só admin vê
  parent_job_id uuid references public.quote_analysis_jobs(id) on delete set null,
  idempotency_key text not null,
  input_snapshot jsonb not null default '{}'::jsonb,       -- notas, mídias REGISTRADAS (urls), motivo de exceção de fotos, id da regra comercial (nunca valores)
  photo_count integer not null default 0,
  photo_exception_reason text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  next_run_at timestamptz not null default now(),
  locked_by text,
  locked_until timestamptz,
  budget_usd numeric(10,4) not null default 0.60,
  spent_usd numeric(12,6) not null default 0,
  reserved_usd numeric(12,6) not null default 0,
  ai_calls integer not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  pending_items jsonb not null default '[]'::jsonb,        -- o que ficou pendente (orçamento esgotado, erro, pesquisa pendente)
  step_results jsonb not null default '{}'::jsonb,         -- resultado parcial de cada etapa (retomada)
  error_code text,
  error_message text,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint quote_jobs_idempotency_unique unique (idempotency_key),
  check (spent_usd >= 0 and reserved_usd >= 0)
);
create index if not exists quote_jobs_runnable_idx on public.quote_analysis_jobs (next_run_at) where status in ('queued', 'running');
create index if not exists quote_jobs_appointment_idx on public.quote_analysis_jobs (appointment_id, created_at desc);
create index if not exists quote_jobs_org_month_idx on public.quote_analysis_jobs (org_id, created_at);

-- ---------------------------------------------------------------
-- Rascunhos/versões da cotação (camada TÉCNICA)
-- ---------------------------------------------------------------
create table if not exists public.quote_drafts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  job_id uuid references public.quote_analysis_jobs(id) on delete set null,
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),            -- estado TÉCNICO
  technical_check text not null default 'needs_confirmation'
    check (technical_check in ('ready_for_review', 'needs_confirmation', 'blocked')),                      -- auditor
  commercial_status text not null default 'not_sent'
    check (commercial_status in ('not_sent', 'sent', 'client_approved', 'client_rejected')),               -- estado COMERCIAL, separado
  diagnosis jsonb,
  photo_exception_reason text,
  client_text_en text,
  tech_text_pt text,
  warnings jsonb not null default '[]'::jsonb,
  ai_original jsonb not null default '{}'::jsonb,          -- cópia do que a IA produziu (auditoria; nunca editada)
  edited_fields text[] not null default '{}',
  materials_total_micros bigint,                           -- total TÉCNICO de materiais (preço de compra)
  materials_verified_micros bigint,
  materials_estimated_micros bigint,
  pending_price_count integer not null default 0,
  approved_by uuid,
  approved_at timestamptz,
  approval_snapshot jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_drafts_version_unique unique (appointment_id, version)
);
create index if not exists quote_drafts_appointment_idx on public.quote_drafts (appointment_id, version desc);

-- Itens (materiais/consumíveis/ferramentas) — preço de COMPRA (visível ao técnico)
create table if not exists public.quote_items (
  id uuid primary key default uuid_generate_v4(),
  draft_id uuid not null references public.quote_drafts(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  position integer not null default 0,
  kind text not null default 'material' check (kind in ('material', 'consumable', 'tool')),
  necessity text not null default 'required' check (necessity in ('required', 'conditional')),
  name_en text not null,
  description_pt text,
  quantity numeric(14,4) not null check (quantity > 0),
  unit text not null,
  brand text,
  model text,
  part_number text,            -- nunca inventado: null até haver fonte
  dimensions text,
  specs jsonb,
  compatibility text,
  reason text,
  confidence text check (confidence in ('high', 'medium', 'low')),
  needs_confirmation text,
  waste_pct numeric(6,3),
  waste_justification text,    -- desperdício só com justificativa técnica
  billable boolean not null default true,   -- ferramenta não é cobrável automaticamente
  price_status text not null default 'pending'
    check (price_status in ('verified', 'estimated', 'technician_corrected', 'pending')),
  unit_price_micros bigint check (unit_price_micros is null or unit_price_micros >= 0),
  original_unit_price_micros bigint,       -- preço sugerido pela IA antes de correção do técnico
  price_currency text not null default 'USD',
  selected_option_id uuid,
  edited_by_technician boolean not null default false,
  ai_original jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- sem preço = "pesquisa pendente": nunca um valor inventado para completar
  check (price_status <> 'pending' or unit_price_micros is null or edited_by_technician)
);
create index if not exists quote_items_draft_idx on public.quote_items (draft_id, position);

-- Opções de produto pesquisadas (fornecedor, link específico, preço e prova)
create table if not exists public.quote_item_options (
  id uuid primary key default uuid_generate_v4(),
  item_id uuid not null references public.quote_items(id) on delete cascade,
  draft_id uuid not null references public.quote_drafts(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  supplier text not null,
  product_url text not null check (product_url ~ '^https://'),
  title text,
  brand text,
  model text,
  sku text,
  price_micros bigint check (price_micros is null or price_micros >= 0),
  currency text not null default 'USD',
  retrieved_at timestamptz not null,       -- data e hora da consulta
  evidence jsonb,                          -- citação/trecho que sustenta o preço
  link_check jsonb,                        -- {result: ok|blocked|broken|not_checked, status, checked_at}
  stock_verified boolean not null default false,
  match_score numeric(5,4),
  is_selected boolean not null default false,
  from_cache boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists quote_item_options_item_idx on public.quote_item_options (item_id);

-- Plano de mão de obra — SÓ tempo e pessoas. NENHUMA coluna monetária (regra de visibilidade financeira).
create table if not exists public.quote_labor_plan (
  id uuid primary key default uuid_generate_v4(),
  draft_id uuid not null unique references public.quote_drafts(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  technicians integer not null default 1 check (technicians >= 1),
  service_hours numeric(8,3) not null check (service_hours >= 0),
  man_hours numeric(8,3) not null check (man_hours >= 0),     -- técnicos × horas de serviço
  travel_hours numeric(8,3),
  idle_hours numeric(8,3),                                    -- espera não produtiva (cura/secagem)
  billable_hours_basis text,                                  -- referência textual; o valor monetário vive só na camada admin
  multi_technician_justification text,
  justification_pt text,
  description_en text,
  breakdown jsonb,
  edited_by_technician boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (technicians = 1 or multi_technician_justification is not null)   -- 2+ técnicos só com justificativa concreta
);

-- Mídias da cotação: REFERENCIAM arquivos existentes (service_order_photos), nunca duplicam
create table if not exists public.quote_draft_media (
  id uuid primary key default uuid_generate_v4(),
  draft_id uuid not null references public.quote_drafts(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  media_url text not null,
  role text not null default 'photo' check (role in ('photo', 'video', 'label', 'measurement')),
  position integer not null default 0,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists quote_draft_media_draft_idx on public.quote_draft_media (draft_id, position);

-- ---------------------------------------------------------------
-- Camada COMERCIAL — SOMENTE ADMIN (tarifas, custo interno, markup, margem, lucro)
-- ---------------------------------------------------------------
create table if not exists public.quote_commercial (
  id uuid primary key default uuid_generate_v4(),
  draft_id uuid not null unique references public.quote_drafts(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  rate_card_id uuid references public.quote_rate_cards(id) on delete set null,
  rate_card_snapshot jsonb,                    -- regra usada (auditável)
  billed_labor_micros bigint,                  -- preço de venda da mão de obra
  internal_labor_cost_micros bigint,           -- custo interno (pago ao técnico)
  materials_markup_micros bigint,
  taxes_micros bigint,
  commercial_total_micros bigint,
  margin_micros bigint,
  notes text,
  computed_at timestamptz,
  computed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Histórico de alterações (visibility separa o que o técnico pode ver)
create table if not exists public.quote_events (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  draft_id uuid references public.quote_drafts(id) on delete cascade,
  job_id uuid references public.quote_analysis_jobs(id) on delete set null,
  actor_id uuid,
  actor_role text,
  type text not null,
  diff jsonb,
  visibility text not null default 'technician' check (visibility in ('technician', 'admin')),
  created_at timestamptz not null default now()
);
create index if not exists quote_events_draft_idx on public.quote_events (draft_id, created_at);

-- ---------------------------------------------------------------
-- RLS
--  * "technician-readable": quem enxerga a ORDEM (o técnico dono, via RLS de appointments) lê a camada técnica;
--    o admin da unidade também. Escrita: só service role (rotas de servidor) nesta fase.
--  * ADMIN-only: sem policy de leitura para funcionário.
-- ---------------------------------------------------------------
alter table public.quote_analysis_jobs enable row level security;
alter table public.quote_drafts enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_item_options enable row level security;
alter table public.quote_labor_plan enable row level security;
alter table public.quote_draft_media enable row level security;
alter table public.quote_commercial enable row level security;
alter table public.quote_events enable row level security;

-- ADMIN-ONLY (jobs trazem custo de IA; commercial traz tarifas/margem)
drop policy if exists quote_jobs_admin_select on public.quote_analysis_jobs;
create policy quote_jobs_admin_select on public.quote_analysis_jobs
  for select using (public.is_org_admin() and public.can_access_unit(unit_id));

drop policy if exists quote_commercial_admin_all on public.quote_commercial;
create policy quote_commercial_admin_all on public.quote_commercial
  for all using (public.is_org_admin() and public.can_access_unit(unit_id))
  with check (public.is_org_admin() and public.can_access_unit(unit_id));

-- Camada técnica: leitura por quem enxerga a ordem (RLS de appointments já restringe o técnico à própria linha).
-- Em modo SHADOW o técnico NÃO deve ver nada: só admin lê rascunhos de jobs 'shadow'.
create or replace function public.quote_draft_visible_to_caller(p_draft_id uuid, p_job_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when public.is_org_admin() then true
    when p_job_id is null then true
    else coalesce((select j.mode = 'live' from public.quote_analysis_jobs j where j.id = p_job_id), false)
  end;
$$;

drop policy if exists quote_drafts_select on public.quote_drafts;
create policy quote_drafts_select on public.quote_drafts
  for select using (
    public.can_access_unit(unit_id)
    and exists (select 1 from public.appointments a where a.id = quote_drafts.appointment_id)
    and public.quote_draft_visible_to_caller(id, job_id)
  );

drop policy if exists quote_items_select on public.quote_items;
create policy quote_items_select on public.quote_items
  for select using (
    public.can_access_unit(unit_id)
    and exists (select 1 from public.quote_drafts d where d.id = quote_items.draft_id)
  );

drop policy if exists quote_item_options_select on public.quote_item_options;
create policy quote_item_options_select on public.quote_item_options
  for select using (
    public.can_access_unit(unit_id)
    and exists (select 1 from public.quote_drafts d where d.id = quote_item_options.draft_id)
  );

drop policy if exists quote_labor_plan_select on public.quote_labor_plan;
create policy quote_labor_plan_select on public.quote_labor_plan
  for select using (
    public.can_access_unit(unit_id)
    and exists (select 1 from public.quote_drafts d where d.id = quote_labor_plan.draft_id)
  );

drop policy if exists quote_draft_media_select on public.quote_draft_media;
create policy quote_draft_media_select on public.quote_draft_media
  for select using (
    public.can_access_unit(unit_id)
    and exists (select 1 from public.quote_drafts d where d.id = quote_draft_media.draft_id)
  );

-- Eventos: admin vê tudo; técnico só o que é 'technician' (e só das suas ordens, e nunca em shadow)
drop policy if exists quote_events_select on public.quote_events;
create policy quote_events_select on public.quote_events
  for select using (
    public.can_access_unit(unit_id)
    and (
      public.is_org_admin()
      or (
        visibility = 'technician'
        and exists (select 1 from public.appointments a where a.id = quote_events.appointment_id)
        and (draft_id is null or exists (select 1 from public.quote_drafts d where d.id = quote_events.draft_id))
      )
    )
  );

-- updated_at
drop trigger if exists quote_jobs_updated_at on public.quote_analysis_jobs;
create trigger quote_jobs_updated_at before update on public.quote_analysis_jobs for each row execute function public.quote_set_updated_at();
drop trigger if exists quote_drafts_updated_at on public.quote_drafts;
create trigger quote_drafts_updated_at before update on public.quote_drafts for each row execute function public.quote_set_updated_at();
drop trigger if exists quote_items_updated_at on public.quote_items;
create trigger quote_items_updated_at before update on public.quote_items for each row execute function public.quote_set_updated_at();
drop trigger if exists quote_labor_plan_updated_at on public.quote_labor_plan;
create trigger quote_labor_plan_updated_at before update on public.quote_labor_plan for each row execute function public.quote_set_updated_at();
drop trigger if exists quote_commercial_updated_at on public.quote_commercial;
create trigger quote_commercial_updated_at before update on public.quote_commercial for each row execute function public.quote_set_updated_at();
