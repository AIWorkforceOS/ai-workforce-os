-- ============================================================
-- Retry de enrichment de leads (2026-08-19, auditoria P1.1)
--
-- ensureLeadEnrichment (lib/leads/enrichment.ts) tratava sucesso e
-- falha da pesquisa de e-mail como equivalentes: uma vez tentado
-- (enriched_at preenchido), NUNCA tentava de novo — mesmo quando não
-- achou e-mail. Leads ficavam presos em status='new' pra sempre
-- (confirmado em produção: 9 leads na Mawi Cleaning, 6 na Smarter
-- Matriz nesse estado exato em 18/08/2026).
--
-- Introduz uma máquina de estados explícita + retry automático.
-- ============================================================

alter table leads
  add column if not exists enrichment_status text not null default 'enrichment_pending'
    check (enrichment_status in (
      'enrichment_pending',    -- nunca tentado
      'enrichment_processing', -- reservado para uso futuro (worker concorrente) — não escrito hoje
      'email_found',           -- terminal, sucesso
      'email_not_found',       -- terminal, desistiu após atingir o limite de tentativas
      'retry_scheduled',       -- não achou ainda, próxima tentativa agendada
      'enrichment_failed'      -- erro inesperado na pesquisa em si (não "não achou", e sim "quebrou")
    )),
  add column if not exists enrichment_attempts int not null default 0,
  add column if not exists next_enrichment_retry_at timestamptz,
  add column if not exists enrichment_source text,   -- 'website' | 'google_places' | null
  add column if not exists enrichment_error text;

create index if not exists leads_enrichment_retry_idx
  on leads(enrichment_status, next_enrichment_retry_at)
  where enrichment_status = 'retry_scheduled';

comment on column leads.enrichment_status is
  'Estado do enrichment (lib/leads/enrichment.ts) — substitui o antigo "só tenta uma vez" (enriched_at). Ver check constraint para os valores válidos.';
comment on column leads.next_enrichment_retry_at is
  'Quando a próxima tentativa automática pode acontecer — só relevante quando enrichment_status=retry_scheduled. Não há cron dedicado: o cron de prospecção existente (api/cron/prospecting*) já re-varre leads status=new e chama ensureLeadEnrichment, que respeita esta data; POST /api/leads/[id]/retry-enrichment força uma tentativa imediata (force:true), ignorando-a.';

-- Backfill: leads que já foram pesquisados antes desta migration (todo
-- enrichment histórico era "uma tentativa só, sem estado"). Quem já achou
-- e-mail vira email_found; quem foi tentado mas ficou sem e-mail vira
-- retry_scheduled com retry IMEDIATO (now()) — são exatamente os leads
-- presos descritos na auditoria de 18/08.
update leads set enrichment_status = 'email_found', enrichment_attempts = 1
  where enriched_at is not null and email is not null and enrichment_status = 'enrichment_pending';

update leads set enrichment_status = 'retry_scheduled', enrichment_attempts = 1, next_enrichment_retry_at = now()
  where enriched_at is not null and email is null and enrichment_status = 'enrichment_pending';
