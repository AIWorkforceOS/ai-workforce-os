-- ============================================================
-- AI Workforce OS — Migration 43: E-mail marketing em massa (campanha/newsletter)
--
-- Quarto build do time de marketing da Alizo. Distinto do e-mail 1:1 do
-- Sales Rep (leads.email via lib/email.ts:sendLeadEmail, motor de
-- outreach do SDR) — aqui é campanha desenhada UMA VEZ e enviada para uma
-- LISTA (leads que não fecharam e/ou clientes cadastrados).
--
-- Desenho:
--   marketing_campaigns           — a campanha (assunto + corpo em texto
--     puro; o HTML final com a marca da unidade + link de descadastro é
--     montado em envio, por destinatário, porque o link de descadastro é
--     único por lead/customer).
--   marketing_campaign_recipients — snapshot da lista no momento do envio
--     (materializado só na aprovação, nunca antes — o público pode mudar
--     entre o rascunho e a aprovação).
--
-- Diferente de content_posts/seo_content_items (cuja criação é do motor
-- via cron, service role, e só a decisão humana passa pela sessão), aqui
-- NÃO há motor autônomo: toda escrita (criar rascunho via IA, aprovar,
-- editar, rejeitar, enviar) é sempre disparada por um humano org_admin
-- na sessão dele — então a RLS de escrita é uniformemente
-- can_access_unit(unit_id) + is_org_admin(), sem policy própria para
-- service role.
--
-- Descadastro (unsubscribe): leads/customers ganham marketing_opt_out +
-- unsubscribe_token (uuid estável, não rotaciona) — o link no rodapé do
-- e-mail de campanha aponta para /api/public/unsubscribe?type=..&token=..,
-- uma rota pública (sem sessão) que precisa de service role para gravar,
-- mesmo padrão de risco baixo do public_lead_intake_token (migration 022):
-- se o token vazar, o pior caso é aquele lead/cliente ser descadastrado.
-- ============================================================

-- ------------------------------------------------------------
-- leads / customers: opt-out de marketing em massa
-- ------------------------------------------------------------
alter table leads add column if not exists marketing_opt_out boolean not null default false;
alter table leads add column if not exists unsubscribe_token uuid not null default uuid_generate_v4();

alter table customers add column if not exists marketing_opt_out boolean not null default false;
alter table customers add column if not exists unsubscribe_token uuid not null default uuid_generate_v4();

create unique index if not exists leads_unsubscribe_token_idx on leads(unsubscribe_token);
create unique index if not exists customers_unsubscribe_token_idx on customers(unsubscribe_token);

-- ------------------------------------------------------------
-- TABELA: marketing_campaigns
-- ------------------------------------------------------------
create table if not exists marketing_campaigns (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  -- objetivo em texto livre dado pelo humano (ex.: "avisar sobre promoção de inverno"),
  -- guardado também quando a campanha nasce de um conteúdo existente (vira a instrução extra).
  objective text not null default '',
  subject text not null default '',
  -- corpo em texto puro (parágrafos separados por linha em branco); o HTML
  -- com a marca da unidade + link de descadastro é montado em envio
  -- (lib/email.ts:buildMarketingEmailHtml), nunca guardado pronto aqui.
  body_text text not null default '',
  -- de onde veio o conteúdo-base: 'objective' (IA gerou do zero) |
  -- 'content_post' | 'seo_content_item' (IA adaptou um conteúdo já
  -- aprovado do Conteúdo/Social ou do SEO para o formato de e-mail).
  source_type text not null default 'objective',
  source_id uuid,
  audience_type text not null default 'leads',   -- leads | customers | both
  -- { lead_statuses?: string[], stale_days?: number|null, customer_status?: 'active'|'inactive'|'all' }
  audience_filter jsonb not null default '{}',
  status text not null default 'pending_approval',
    -- pending_approval | approved | rejected | sending | sent | failed
  reasoning text not null default '',
  -- contagem materializada só na aprovação (antes disso é sempre 0 — a
  -- lista real só existe no momento do envio, ver comentário acima)
  recipients_total int not null default 0,
  recipients_sent int not null default 0,
  recipients_failed int not null default 0,
  recipients_skipped int not null default 0,
  error_message text,
  decided_by text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_campaigns_unit_idx on marketing_campaigns(unit_id, created_at desc);
create index if not exists marketing_campaigns_status_idx
  on marketing_campaigns(status) where status = 'pending_approval';

create trigger marketing_campaigns_updated_at before update on marketing_campaigns
  for each row execute function update_updated_at();

alter table marketing_campaigns enable row level security;

drop policy if exists marketing_campaigns_select on marketing_campaigns;
create policy marketing_campaigns_select on marketing_campaigns
  for select using (public.can_access_unit(unit_id));

drop policy if exists marketing_campaigns_insert on marketing_campaigns;
create policy marketing_campaigns_insert on marketing_campaigns
  for insert with check (public.can_access_unit(unit_id) and public.is_org_admin());

drop policy if exists marketing_campaigns_update on marketing_campaigns;
create policy marketing_campaigns_update on marketing_campaigns
  for update using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

drop policy if exists marketing_campaigns_delete on marketing_campaigns;
create policy marketing_campaigns_delete on marketing_campaigns
  for delete using (public.is_super_admin());

-- ------------------------------------------------------------
-- TABELA: marketing_campaign_recipients — snapshot da lista no envio
-- ------------------------------------------------------------
create table if not exists marketing_campaign_recipients (
  id uuid primary key default uuid_generate_v4(),
  campaign_id uuid not null references marketing_campaigns(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade, -- denormalizado para a RLS
  recipient_type text not null,   -- lead | customer
  recipient_id uuid not null,
  email text not null,
  -- cópia do leads.unsubscribe_token/customers.unsubscribe_token no momento
  -- do envio — o link de descadastro do e-mail aponta pra este valor, não
  -- pro id da linha aqui, pra ficar estável mesmo que esta linha suma
  -- (delete de campanha) e pra nunca expor o id interno do lead/cliente.
  unsubscribe_token uuid,
  status text not null default 'pending',
    -- pending | sent | failed | skipped_opt_out | skipped_no_email
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, recipient_type, recipient_id)
);

create index if not exists marketing_campaign_recipients_campaign_idx
  on marketing_campaign_recipients(campaign_id);

alter table marketing_campaign_recipients enable row level security;

drop policy if exists marketing_campaign_recipients_select on marketing_campaign_recipients;
create policy marketing_campaign_recipients_select on marketing_campaign_recipients
  for select using (public.can_access_unit(unit_id));

drop policy if exists marketing_campaign_recipients_insert on marketing_campaign_recipients;
create policy marketing_campaign_recipients_insert on marketing_campaign_recipients
  for insert with check (public.can_access_unit(unit_id) and public.is_org_admin());

drop policy if exists marketing_campaign_recipients_update on marketing_campaign_recipients;
create policy marketing_campaign_recipients_update on marketing_campaign_recipients
  for update using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

drop policy if exists marketing_campaign_recipients_delete on marketing_campaign_recipients;
create policy marketing_campaign_recipients_delete on marketing_campaign_recipients
  for delete using (public.is_super_admin());
