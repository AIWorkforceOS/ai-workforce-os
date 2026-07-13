-- ============================================================
-- AI Workforce OS — Migration 7: Traffic Specialist (Digital Employee)
--
-- Funcionário digital de Tráfego Pago (Meta Ads + Google Ads):
--   ad_accounts          — contas de anúncio conectadas por unidade
--   ad_entities          — hierarquia campanha/conjunto/anúncio (ambas plataformas)
--   ad_metrics_snapshots — snapshots diários de performance por entidade
--   traffic_decisions    — decisões do motor de estratégia (sempre com rationale)
--   ad_actions_log       — auditoria imutável de toda ação executada em conta real
--   traffic_reports      — relatórios executivos periódicos (linguagem de negócio)
--
-- RLS: mesma receita da migration 20260707000005 — leitura com
-- can_access_unit(unit_id); escrita com can_access_unit + is_org_admin.
-- Service role (cron/webhooks) ignora RLS, como no resto do OS.
--
-- agent_configs: sem mudança de schema — o Traffic Specialist usa
-- agent_type = 'traffic_specialist' (coluna text). Alvos de otimização
-- (CPA/ROAS alvo, modo sugestão×autônomo) vivem por conta em
-- ad_accounts.optimization_mode / ad_accounts.strategy.
-- ============================================================

-- ------------------------------------------------------------
-- TABELA: ad_accounts — contas de anúncio conectadas
-- ------------------------------------------------------------
create table if not exists ad_accounts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  platform text not null,                        -- 'meta' | 'google'
  external_account_id text not null,             -- act_<id> (Meta) | customer id sem hífens (Google)
  name text not null,
  currency text not null default 'BRL',
  timezone text not null default 'America/Sao_Paulo',
  -- Credenciais por conta (preenchidas via painel, nunca no repo).
  -- Meta: system user token com ads_read/ads_management na conta.
  -- Google: refresh token OAuth do usuário com acesso à conta.
  access_token text,
  refresh_token text,
  connection_status text not null default 'pending_credentials',
    -- pending_credentials | connected | error | disconnected
  connection_error text,
  -- 'suggestion' = motor recomenda e humano aprova (padrão seguro);
  -- 'autonomous' = motor executa direto (ativação consciente pelo cliente).
  optimization_mode text not null default 'suggestion',
  -- Alvos e limites do motor de estratégia (ver lib/traffic/types.ts):
  -- target_cpa_cents, target_roas, min_daily_budget_cents,
  -- max_daily_budget_cents, max_budget_change_pct, cpa_pause_multiplier,
  -- min_conversions_for_decision, frequency_fatigue_threshold, etc.
  strategy jsonb not null default '{}',
  last_synced_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, platform, external_account_id)
);

create index if not exists ad_accounts_unit_idx on ad_accounts(unit_id);
create index if not exists ad_accounts_org_idx on ad_accounts(org_id);

-- ------------------------------------------------------------
-- TABELA: ad_entities — campanhas / conjuntos / anúncios geridos
-- Uma tabela única para a hierarquia das duas plataformas:
--   Meta:   campaign → ad_set → ad
--   Google: campaign → ad_group → ad
-- ------------------------------------------------------------
create table if not exists ad_entities (
  id uuid primary key default uuid_generate_v4(),
  ad_account_id uuid not null references ad_accounts(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,  -- denormalizado p/ RLS
  platform text not null,                        -- 'meta' | 'google'
  entity_level text not null,                    -- 'campaign' | 'ad_set' | 'ad'
  external_id text not null,                     -- id na plataforma
  parent_external_id text,                       -- id do pai na hierarquia
  name text not null,
  status text not null default 'UNKNOWN',        -- status normalizado: ACTIVE | PAUSED | ARCHIVED | REMOVED | UNKNOWN
  objective text,                                -- objetivo da campanha (OUTCOME_SALES, LEADS, SEARCH...)
  funnel_stage text,                             -- 'awareness' | 'consideration' | 'conversion' (classificado pelo motor)
  daily_budget_cents bigint,                     -- orçamento diário em centavos (nível onde a plataforma o define)
  bid_strategy text,                             -- LOWEST_COST_WITHOUT_CAP, TARGET_CPA, MAXIMIZE_CONVERSIONS...
  is_managed boolean not null default true,      -- false = agente só observa, nunca toca
  raw jsonb not null default '{}',               -- payload bruto da plataforma (targeting, criativos, etc.)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_account_id, entity_level, external_id)
);

create index if not exists ad_entities_account_idx on ad_entities(ad_account_id);
create index if not exists ad_entities_unit_idx on ad_entities(unit_id);
create index if not exists ad_entities_parent_idx on ad_entities(parent_external_id);

-- ------------------------------------------------------------
-- TABELA: ad_metrics_snapshots — performance diária por entidade
-- ------------------------------------------------------------
create table if not exists ad_metrics_snapshots (
  id uuid primary key default uuid_generate_v4(),
  entity_id uuid not null references ad_entities(id) on delete cascade,
  ad_account_id uuid not null references ad_accounts(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,  -- denormalizado p/ RLS
  snapshot_date date not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  spend_cents bigint not null default 0,
  conversions numeric(12,2) not null default 0,
  conversion_value_cents bigint not null default 0,
  reach bigint,
  frequency numeric(8,3),                        -- Meta: sinal de fadiga de criativo
  -- Métricas derivadas persistidas para consulta/gráfico sem recomputar:
  ctr numeric(8,4),                              -- clicks/impressions (%)
  cpc_cents bigint,                              -- spend/clicks
  cpm_cents bigint,                              -- spend/impressions*1000
  cpa_cents bigint,                              -- spend/conversions
  roas numeric(10,4),                            -- conversion_value/spend
  extra jsonb not null default '{}',             -- métricas específicas da plataforma (video views, quality score...)
  created_at timestamptz not null default now(),
  unique (entity_id, snapshot_date)
);

create index if not exists ad_metrics_snapshots_entity_date_idx
  on ad_metrics_snapshots(entity_id, snapshot_date desc);
create index if not exists ad_metrics_snapshots_account_date_idx
  on ad_metrics_snapshots(ad_account_id, snapshot_date desc);

-- ------------------------------------------------------------
-- TABELA: traffic_decisions — decisões do motor (com rationale)
-- Mesmo princípio do decision log do Recruiter: toda decisão
-- autônoma registra o quê, o porquê e o contexto.
-- ------------------------------------------------------------
create table if not exists traffic_decisions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  ad_account_id uuid not null references ad_accounts(id) on delete cascade,
  entity_id uuid references ad_entities(id) on delete set null,
  decision_type text not null,
    -- pause_entity | resume_entity | increase_budget | decrease_budget |
    -- reallocate_budget | change_bid_strategy | refresh_creative |
    -- new_audience_suggestion | landing_page_suggestion | anomaly_alert |
    -- funnel_rebalance | seasonal_adjustment | policy_risk_alert
  severity text not null default 'info',         -- info | warning | critical
  reasoning text not null,                       -- justificativa legível por humano (sempre)
  recommended_action jsonb not null default '{}',-- payload executável (ex: {"set_daily_budget_cents": 5000})
  metrics_context jsonb not null default '{}',   -- métricas que embasaram a decisão (auditável)
  mode text not null,                            -- 'suggestion' | 'autonomous' (modo vigente na criação)
  status text not null default 'suggested',
    -- suggested | approved | rejected | executed | failed | expired
  decided_by text,                               -- e-mail do humano que aprovou/rejeitou (null = autônomo)
  executed_at timestamptz,
  expires_at timestamptz,                        -- sugestões velhas expiram (métricas mudam)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists traffic_decisions_account_idx
  on traffic_decisions(ad_account_id, created_at desc);
create index if not exists traffic_decisions_status_idx
  on traffic_decisions(status) where status in ('suggested', 'approved');

-- ------------------------------------------------------------
-- TABELA: ad_actions_log — auditoria imutável de ações reais
-- Toda mudança feita numa conta de anúncio do cliente fica aqui,
-- com o payload enviado, o estado anterior e a resposta da API.
-- ------------------------------------------------------------
create table if not exists ad_actions_log (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  ad_account_id uuid not null references ad_accounts(id) on delete cascade,
  entity_id uuid references ad_entities(id) on delete set null,
  decision_id uuid references traffic_decisions(id) on delete set null,
  platform text not null,
  action_type text not null,                     -- pause | resume | set_budget | set_bid_strategy
  payload_sent jsonb not null default '{}',      -- exatamente o que foi enviado à API
  previous_state jsonb not null default '{}',    -- estado antes da mudança (permite reverter)
  result text not null,                          -- 'success' | 'failed' | 'dry_run'
  external_response jsonb,                       -- resposta da plataforma
  error_message text,
  executed_by text not null,                     -- 'agent_autonomous' | 'human_approved:<email>'
  created_at timestamptz not null default now()
);

create index if not exists ad_actions_log_account_idx
  on ad_actions_log(ad_account_id, created_at desc);

-- ------------------------------------------------------------
-- TABELA: traffic_reports — relatórios executivos periódicos
-- ------------------------------------------------------------
create table if not exists traffic_reports (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  ad_account_id uuid not null references ad_accounts(id) on delete cascade,
  report_type text not null default 'daily',     -- daily | weekly
  period_start date not null,
  period_end date not null,
  summary text not null,                         -- texto executivo em linguagem de negócio (PT-BR)
  highlights jsonb not null default '{}',        -- números-chave estruturados do período
  created_at timestamptz not null default now(),
  unique (ad_account_id, report_type, period_start, period_end)
);

create index if not exists traffic_reports_account_idx
  on traffic_reports(ad_account_id, created_at desc);

-- ------------------------------------------------------------
-- TRIGGERS de updated_at
-- ------------------------------------------------------------
create trigger ad_accounts_updated_at before update on ad_accounts
  for each row execute function update_updated_at();

create trigger ad_entities_updated_at before update on ad_entities
  for each row execute function update_updated_at();

create trigger traffic_decisions_updated_at before update on traffic_decisions
  for each row execute function update_updated_at();

-- ------------------------------------------------------------
-- RLS — mesma receita da migration 20260707000005
-- ------------------------------------------------------------
alter table ad_accounts enable row level security;

drop policy if exists ad_accounts_select on ad_accounts;
create policy ad_accounts_select on ad_accounts
  for select using (public.can_access_unit(unit_id));

drop policy if exists ad_accounts_write on ad_accounts;
create policy ad_accounts_write on ad_accounts
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

alter table ad_entities enable row level security;

drop policy if exists ad_entities_select on ad_entities;
create policy ad_entities_select on ad_entities
  for select using (public.can_access_unit(unit_id));

drop policy if exists ad_entities_write on ad_entities;
create policy ad_entities_write on ad_entities
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

alter table ad_metrics_snapshots enable row level security;

drop policy if exists ad_metrics_snapshots_select on ad_metrics_snapshots;
create policy ad_metrics_snapshots_select on ad_metrics_snapshots
  for select using (public.can_access_unit(unit_id));

-- Snapshots são escritos pelo cron (service role); humanos não editam métricas.
drop policy if exists ad_metrics_snapshots_write on ad_metrics_snapshots;
create policy ad_metrics_snapshots_write on ad_metrics_snapshots
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

alter table traffic_decisions enable row level security;

drop policy if exists traffic_decisions_select on traffic_decisions;
create policy traffic_decisions_select on traffic_decisions
  for select using (public.can_access_unit(unit_id));

-- Humanos da org podem aprovar/rejeitar (update); criação é do motor (service role).
drop policy if exists traffic_decisions_update on traffic_decisions;
create policy traffic_decisions_update on traffic_decisions
  for update using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

drop policy if exists traffic_decisions_insert on traffic_decisions;
create policy traffic_decisions_insert on traffic_decisions
  for insert with check (public.is_super_admin());

drop policy if exists traffic_decisions_delete on traffic_decisions;
create policy traffic_decisions_delete on traffic_decisions
  for delete using (public.is_super_admin());

alter table ad_actions_log enable row level security;

-- Auditoria: leitura escopada; escrita apenas via service role/super admin;
-- nunca update/delete por usuários comuns (log imutável).
drop policy if exists ad_actions_log_select on ad_actions_log;
create policy ad_actions_log_select on ad_actions_log
  for select using (public.can_access_unit(unit_id));

drop policy if exists ad_actions_log_insert on ad_actions_log;
create policy ad_actions_log_insert on ad_actions_log
  for insert with check (public.is_super_admin());

alter table traffic_reports enable row level security;

drop policy if exists traffic_reports_select on traffic_reports;
create policy traffic_reports_select on traffic_reports
  for select using (public.can_access_unit(unit_id));

drop policy if exists traffic_reports_write on traffic_reports;
create policy traffic_reports_write on traffic_reports
  for all using (public.is_super_admin())
  with check (public.is_super_admin());
