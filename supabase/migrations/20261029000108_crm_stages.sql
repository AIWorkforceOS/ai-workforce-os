-- Migration 108 — Etapas do funil de vendas configuráveis. ADITIVA; NÃO aplicada até autorização.
-- O funil continua com os 6 comportamentos que os automatismos usam (leads.status: new, contacted, replied, negotiating, won, lost). A empresa passa a poder
-- NOMEAR, REORDENAR, COLORIR e ACRESCENTAR etapas; cada etapa diz "com qual comportamento" ela conta (kind). Mover um lead para uma etapa grava o status
-- do comportamento dela, então agentes, métricas e conversões seguem funcionando sem mudança.
--  * crm_stages: etapas da EMPRESA (compartilhadas pelas unidades). Sem nenhuma linha = funil padrão de 6 etapas, exatamente como hoje.
--  * leads.stage_id: etapa escolhida do lead (NULL = a primeira etapa do comportamento do status, como todos os leads atuais).
-- Acesso: administrador da empresa (mesmo critério de leads); em política restritiva, só administrador completo ou função Comercial.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.crm_stages (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('new', 'contacted', 'replied', 'negotiating', 'won', 'lost')),
  color text not null default 'slate' check (color in ('slate', 'blue', 'amber', 'purple', 'green', 'red', 'cyan', 'pink')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint crm_stages_name_len check (char_length(btrim(name)) between 1 and 40)
);
create unique index if not exists crm_stages_org_name_uq on public.crm_stages (org_id, lower(btrim(name)));
create index if not exists crm_stages_org_pos_idx on public.crm_stages (org_id, position);

alter table public.crm_stages enable row level security;
drop policy if exists crm_stages_select on public.crm_stages;
create policy crm_stages_select on public.crm_stages
  for select using (public.is_org_member(org_id) and public.current_app_role() is distinct from 'employee' and public.current_app_role() is distinct from 'client');
drop policy if exists crm_stages_write on public.crm_stages;
create policy crm_stages_write on public.crm_stages
  for all using (public.is_org_admin() and public.is_org_member(org_id))
  with check (public.is_org_admin() and public.is_org_member(org_id));
drop policy if exists crm_stages_job_role on public.crm_stages;
create policy crm_stages_job_role on public.crm_stages
  as restrictive for all
  using (public.current_job_role() is null or public.current_job_role() = 'comercial')
  with check (public.current_job_role() is null or public.current_job_role() = 'comercial');

alter table public.leads add column if not exists stage_id uuid references public.crm_stages(id) on delete set null;
create index if not exists leads_stage_idx on public.leads (stage_id) where stage_id is not null;
