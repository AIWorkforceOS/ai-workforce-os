-- ============================================================
-- AI Workforce OS — Migration 8: Recruiter Employee
--
-- Segundo funcionário digital da plataforma (agent_type = 'recruiter').
-- Cria o schema completo do processo de recrutamento:
--   - job_openings                 vagas (máquina de estados §4.1 da spec)
--   - candidates                   banco de talentos por organização
--   - job_candidates               pipeline candidato×vaga (§4.2)
--   - candidate_messages           conversas com candidatos (WhatsApp/e-mail)
--   - recruiter_decisions          decision log de toda decisão autônoma
--   - recruiter_events             auditoria de processo (≠ system_events)
--   - company_recruiting_profiles  memória de preferências por empresa
--
-- Ranking usa pgvector (embeddings OpenAI text-embedding-3-small, 1536 dims).
-- RLS com os mesmos helpers da migration 20260707000005.
-- Spec: docs/employees/recruiter-employee-spec.md
-- ============================================================

create extension if not exists vector;

-- ------------------------------------------------------------
-- TABELA: job_openings (vagas)
-- ------------------------------------------------------------
create table if not exists job_openings (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,   -- empresa de origem (Sales Employee)
  title text not null,
  status text not null default 'draft' check (status in (
    'draft', 'profiling', 'profile_ready', 'sourcing', 'sourcing_expanded',
    'outreach', 'screening', 'shortlist_ready', 'presented', 'company_review',
    'candidate_selected', 'handed_off', 'closed', 'stalled', 'escalated_human',
    'cancelled', 'expired'
  )),
  previous_status text,                                   -- para "Devolver ao Recruiter" pós-escalação
  profile jsonb not null default '{}',                    -- perfil ideal da vaga (§6.1.1)
  profile_missing_fields text[] not null default '{}',
  target_shortlist_size int not null default 5,
  urgency text not null default 'normal' check (urgency in ('low', 'normal', 'high')),
  hiring_deadline date,
  source text not null default 'manual',                  -- sales_employee | manual | api
  stalled_since timestamptz,
  follow_up_count int not null default 0,                 -- follow-ups à empresa (máx 3)
  selected_candidate_id uuid,                             -- fk lógica para job_candidates
  handed_off_to text,                                     -- e-mail do humano responsável
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_openings_unit_idx on job_openings(unit_id);
create index if not exists job_openings_org_idx on job_openings(org_id);
create index if not exists job_openings_status_idx on job_openings(status);
create index if not exists job_openings_lead_idx on job_openings(lead_id);

-- ------------------------------------------------------------
-- TABELA: candidates (banco de talentos, escopo = organização)
-- A mesma pessoa pode servir a vagas de várias unidades da org,
-- mas nunca vaza entre orgs (RLS).
-- ------------------------------------------------------------
create table if not exists candidates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  source text not null default 'manual',        -- smarter_api | indeed | infojobs | manual | referral
  external_ref text,                            -- id no sistema de origem (dedupe)
  name text not null,
  email text,
  phone text,
  city text,
  state text,
  course text,
  semester int,
  institution text,
  skills jsonb not null default '[]',
  languages jsonb not null default '[]',
  experience_summary text,
  disc_profile text,                            -- perfil DISC vindo do currículo (fit comportamental)
  resume_url text,
  profile_embedding vector(1536),               -- OpenAI text-embedding-3-small
  consent_status text not null default 'unknown' check (consent_status in ('granted', 'revoked', 'unknown')),
  consent_at timestamptz,
  opted_out boolean not null default false,     -- LGPD: nunca recontatar
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists candidates_dedupe_idx
  on candidates(org_id, source, external_ref) where external_ref is not null;
create index if not exists candidates_org_idx on candidates(org_id);
create index if not exists candidates_phone_idx on candidates(org_id, phone) where phone is not null;
create index if not exists candidates_embedding_idx
  on candidates using hnsw (profile_embedding vector_cosine_ops);

-- ------------------------------------------------------------
-- TABELA: job_candidates (pipeline candidato×vaga)
-- ------------------------------------------------------------
create table if not exists job_candidates (
  id uuid primary key default uuid_generate_v4(),
  job_id uuid not null references job_openings(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,  -- denormalizado p/ RLS
  stage text not null default 'sourced' check (stage in (
    'sourced', 'ranked', 'contacted', 'in_screening', 'screened', 'shortlisted',
    'presented', 'approved', 'not_selected', 'unreachable', 'withdrew', 'disqualified'
  )),
  stage_reason text,                            -- motivo da última transição (memória)
  ai_score numeric(5,2),                        -- 0–100, pós-triagem
  match_score numeric(5,2),                     -- 0–100, pré-triagem (ranking)
  rank int,
  score_breakdown jsonb not null default '{}',  -- rubrica detalhada + dados de triagem
  report jsonb,                                 -- relatório final (§7.6)
  outreach_attempts int not null default 0,     -- tentativas de contato (máx 2)
  contacted_at timestamptz,
  screened_at timestamptz,
  presented_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, candidate_id)
);

create index if not exists job_candidates_job_idx on job_candidates(job_id);
create index if not exists job_candidates_candidate_idx on job_candidates(candidate_id);
create index if not exists job_candidates_stage_idx on job_candidates(job_id, stage);
create index if not exists job_candidates_unit_idx on job_candidates(unit_id);

-- ------------------------------------------------------------
-- TABELA: candidate_messages (conversas com candidatos)
-- Espelha `conversations`, mas com FK para candidato + vaga.
-- Intake com a EMPRESA continua em `conversations` (empresa é lead).
-- ------------------------------------------------------------
create table if not exists candidate_messages (
  id uuid primary key default uuid_generate_v4(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  job_id uuid references job_openings(id) on delete set null,
  unit_id uuid not null references units(id) on delete cascade,
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'email')),
  direction text not null check (direction in ('outbound', 'inbound')),
  content text not null,
  template_key text,
  external_message_id text,
  status text not null default 'sent' check (status in ('sent', 'delivered', 'read', 'failed')),
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists candidate_messages_candidate_idx on candidate_messages(candidate_id, sent_at);
create index if not exists candidate_messages_job_idx on candidate_messages(job_id);
create index if not exists candidate_messages_unit_sent_idx on candidate_messages(unit_id, direction, sent_at);

-- ------------------------------------------------------------
-- TABELA: recruiter_decisions (decision log — toda decisão autônoma)
-- ------------------------------------------------------------
create table if not exists recruiter_decisions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade,
  unit_id uuid references units(id) on delete cascade,
  job_id uuid references job_openings(id) on delete cascade,
  candidate_id uuid references candidates(id) on delete set null,
  decision_type text not null,   -- contact_candidate | skip_candidate | expand_sourcing | pause
                                 -- | follow_up | escalate | disqualify | shortlist | route_ambiguous | ...
  reasoning text not null,       -- justificativa legível por humano
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists recruiter_decisions_job_idx on recruiter_decisions(job_id, created_at desc);
create index if not exists recruiter_decisions_unit_idx on recruiter_decisions(unit_id);

-- ------------------------------------------------------------
-- TABELA: recruiter_events (auditoria de processo, ≠ system_events)
-- ------------------------------------------------------------
create table if not exists recruiter_events (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade,
  unit_id uuid references units(id) on delete cascade,
  job_id uuid references job_openings(id) on delete cascade,
  candidate_id uuid references candidates(id) on delete set null,
  event_type text not null,      -- job.created | job.profile_completed | sourcing.completed | ...
  message text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists recruiter_events_job_idx on recruiter_events(job_id, created_at desc);
create index if not exists recruiter_events_type_idx on recruiter_events(event_type);
create index if not exists recruiter_events_created_idx on recruiter_events(created_at desc);

-- ------------------------------------------------------------
-- TABELA: company_recruiting_profiles (memória por empresa cliente)
-- ------------------------------------------------------------
create table if not exists company_recruiting_profiles (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  preferences jsonb not null default '{}',      -- perfis que aprova/reprova, tom, SLAs
  rejection_patterns jsonb not null default '[]',
  avg_decision_days numeric(6,1),
  nps_score int,
  updated_at timestamptz not null default now(),
  unique (org_id, lead_id)
);

-- ------------------------------------------------------------
-- FUNÇÃO: match_candidates_for_job
-- Estágios 1+2 do ranking: filtros duros (SQL) + recall semântico
-- (pgvector). Campos nulos no candidato passam nos filtros duros —
-- "desconhecido" não é "objetivamente incompatível"; a triagem valida.
-- Guard-rails LGPD (opted_out / consent revogado) aplicados aqui,
-- em código, nunca só em prompt.
-- ------------------------------------------------------------
create or replace function public.match_candidates_for_job(
  p_org_id uuid,
  p_embedding vector(1536),
  p_courses text[] default null,
  p_city text default null,
  p_semester_min int default null,
  p_semester_max int default null,
  p_limit int default 50
)
returns table (candidate_id uuid, similarity double precision)
language sql stable
as $$
  select c.id, 1 - (c.profile_embedding <=> p_embedding) as similarity
  from candidates c
  where c.org_id = p_org_id
    and c.profile_embedding is not null
    and c.opted_out = false
    and c.consent_status <> 'revoked'
    and (
      p_courses is null
      or c.course is null
      or exists (select 1 from unnest(p_courses) pc where c.course ilike '%' || pc || '%')
    )
    and (p_city is null or c.city is null or c.city ilike '%' || p_city || '%')
    and (p_semester_min is null or c.semester is null or c.semester >= p_semester_min)
    and (p_semester_max is null or c.semester is null or c.semester <= p_semester_max)
  order by c.profile_embedding <=> p_embedding
  limit p_limit;
$$;

grant execute on function public.match_candidates_for_job(uuid, vector(1536), text[], text, int, int, int)
  to authenticated, service_role;

-- ------------------------------------------------------------
-- TRIGGERS de updated_at
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'job_openings_updated_at') then
    create trigger job_openings_updated_at before update on job_openings
      for each row execute function update_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'candidates_updated_at') then
    create trigger candidates_updated_at before update on candidates
      for each row execute function update_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'job_candidates_updated_at') then
    create trigger job_candidates_updated_at before update on job_candidates
      for each row execute function update_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'company_recruiting_profiles_updated_at') then
    create trigger company_recruiting_profiles_updated_at before update on company_recruiting_profiles
      for each row execute function update_updated_at();
  end if;
end $$;

-- ------------------------------------------------------------
-- RLS — mesma receita da migration 20260707000005.
-- Service role (webhooks, cron, sourcing) ignora RLS, como hoje.
-- ------------------------------------------------------------

-- Escopadas por unidade → org
alter table job_openings enable row level security;

drop policy if exists job_openings_select on job_openings;
create policy job_openings_select on job_openings
  for select using (public.can_access_unit(unit_id));

drop policy if exists job_openings_write on job_openings;
create policy job_openings_write on job_openings
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

alter table job_candidates enable row level security;

drop policy if exists job_candidates_select on job_candidates;
create policy job_candidates_select on job_candidates
  for select using (public.can_access_unit(unit_id));

drop policy if exists job_candidates_write on job_candidates;
create policy job_candidates_write on job_candidates
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

alter table candidate_messages enable row level security;

drop policy if exists candidate_messages_select on candidate_messages;
create policy candidate_messages_select on candidate_messages
  for select using (public.can_access_unit(unit_id));

drop policy if exists candidate_messages_write on candidate_messages;
create policy candidate_messages_write on candidate_messages
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

alter table recruiter_decisions enable row level security;

drop policy if exists recruiter_decisions_select on recruiter_decisions;
create policy recruiter_decisions_select on recruiter_decisions
  for select using (public.can_access_unit(unit_id));

drop policy if exists recruiter_decisions_write on recruiter_decisions;
create policy recruiter_decisions_write on recruiter_decisions
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

alter table recruiter_events enable row level security;

drop policy if exists recruiter_events_select on recruiter_events;
create policy recruiter_events_select on recruiter_events
  for select using (public.can_access_unit(unit_id));

drop policy if exists recruiter_events_write on recruiter_events;
create policy recruiter_events_write on recruiter_events
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

-- Escopadas direto por org
alter table candidates enable row level security;

drop policy if exists candidates_select on candidates;
create policy candidates_select on candidates
  for select using (public.is_org_member(org_id));

drop policy if exists candidates_write on candidates;
create policy candidates_write on candidates
  for all using (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin())
  )
  with check (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin())
  );

alter table company_recruiting_profiles enable row level security;

drop policy if exists company_recruiting_profiles_select on company_recruiting_profiles;
create policy company_recruiting_profiles_select on company_recruiting_profiles
  for select using (public.is_org_member(org_id));

drop policy if exists company_recruiting_profiles_write on company_recruiting_profiles;
create policy company_recruiting_profiles_write on company_recruiting_profiles
  for all using (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin())
  )
  with check (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin())
  );
