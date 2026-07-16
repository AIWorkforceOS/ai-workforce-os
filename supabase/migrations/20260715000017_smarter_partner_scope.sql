-- ============================================================
-- AI Workforce OS — Migration 17: escopo de parceria com a Smarter
--
-- A integração com a API de candidatos da Smarter (lib/recruiter/smarter-api.ts)
-- usa hoje env vars globais do projeto Vercel (SMARTER_CANDIDATES_API_URL/TOKEN),
-- o que faria QUALQUER organização disparar a busca na base da Smarter assim
-- que as envs fossem configuradas — errado, já que só empresas com cadastro
-- de parceria na Smarter podem acessar esse banco (regra de produto). Outras
-- organizações clientes do Alizo (ex.: Mawi Services) devem seguir usando
-- apenas a base própria de candidatos.
--
-- is_smarter_partner é marcado manualmente (via update direto no banco) só
-- para a(s) organização(ões) que são efetivamente clientes/franquias da
-- Smarter Estágios — não há UI para isso ainda.
-- ============================================================

alter table organizations
  add column if not exists is_smarter_partner boolean not null default false;

comment on column organizations.is_smarter_partner is
  'true somente para organizações que são clientes/franquias da Smarter Estágios — só essas disparam a busca de candidatos na API de parceiros da Smarter (lib/recruiter/smarter-api.ts). Demais organizações usam apenas a base própria de candidatos. Marcado manualmente, sem UI.';
