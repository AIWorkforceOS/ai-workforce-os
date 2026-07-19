-- ============================================================
-- AI Workforce OS — Migration 25: Business Profile + Vertical Templates
-- (fundação de dados, sub-etapa 1/7)
--
-- organizations.vertical_key / organizations.business_profile — novo
-- Business Profile COMPARTILHADO por toda a organização (não por
-- unidade, não por agente). Distinto de agent_configs.business_profile,
-- que continua guardando a ficha da entrevista POR FUNCIONÁRIO
-- (unit_id + agent_type) exatamente como está hoje.
--
-- agent_configs.training_corrections — histórico de correções do
-- futuro "Test Your AI Employee" (sub-etapa 5, não implementado ainda).
--
-- customers.custom_fields — campos dinâmicos por segmento de negócio
-- (sub-etapa 4, não implementado ainda). Schema vem de
-- lib/verticals/catalog.ts.
--
-- Todas as colunas são aditivas com default seguro — não quebram
-- dado existente.
-- ============================================================

alter table organizations add column if not exists vertical_key text;
alter table organizations add column if not exists business_profile jsonb not null default '{}'::jsonb;
comment on column organizations.vertical_key is 'Chave do segmento de negócio (ver lib/verticals/catalog.ts). Null = ainda não definido / genérico.';
comment on column organizations.business_profile is 'Ficha da empresa COMPARTILHADA entre todos os AI Employees da organização (identidade, serviços, políticas, horários, idiomas, canais). Distinto de agent_configs.business_profile, que continua guardando fatos específicos de cada agente.';

alter table agent_configs add column if not exists training_corrections jsonb not null default '[]'::jsonb;
comment on column agent_configs.training_corrections is 'Array de correções feitas pelo usuário ao testar o agente, no mesmo espírito do interview_transcript. Usado a partir da sub-etapa 5.';

alter table customers add column if not exists custom_fields jsonb not null default '{}'::jsonb;
comment on column customers.custom_fields is 'Campos específicos do segmento de negócio (ex.: quartos/banheiros em cleaning, terapeuta/tipo de sessão em clínica). Schema vem de lib/verticals/catalog.ts. Usado a partir da sub-etapa 4.';
