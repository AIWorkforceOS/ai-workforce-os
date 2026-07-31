-- Idempotência de leads de anúncio (Meta/Google Lead Ads): ambos os
-- provedores reentregam o webhook quando o handler não responde 200 a
-- tempo (mesmo padrão de retry que já colocou o WhatsApp da empresa em
-- risco de bloqueio — ver commit 95d0d03). Sem isso, uma reentrega criava
-- um lead duplicado e disparava um segundo primeiro contato pro mesmo
-- lead. O código (lib/leads/ad-lead-intake.ts) já checa por este campo
-- antes de inserir; o índice único abaixo é reforço no banco.
alter table leads add column if not exists external_lead_id text;

create unique index if not exists leads_external_lead_id_unique
  on leads (unit_id, source, external_lead_id)
  where external_lead_id is not null;
