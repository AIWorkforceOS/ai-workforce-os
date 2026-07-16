-- ============================================================
-- AI Workforce OS — Migration 19: integração de recrutamento externo
-- (Smarter) por unidade
--
-- Algumas unidades parceiras da Smarter Estágios querem que o Recruiter
-- (AI) publique as vagas e adicione os candidatos sourced também no
-- sistema de vagas/candidaturas da Smarter (sistema.smarterestagios.com.br),
-- via as rotas de parceiro POST /api/partners/vacancies e
-- POST /api/partners/applications. Isso é configurado por unidade — não
-- há detecção automática por tipo de negócio — e o padrão
-- (recruiting_integration_mode = 'native') mantém o comportamento atual
-- (só o pipeline nativo do Alizo) sem nenhuma mudança. Mesmo padrão de
-- units.crm_integration_mode (migration 018).
--
-- A lógica de negócio do Recruiter fala com um CONTRATO genérico
-- (lib/recruiter/partner-recruiting-client.ts: createVacancy /
-- addCandidateToVacancy) — a Smarter é hoje a única implementação
-- concreta (lib/recruiter/smarter-recruiting-client.ts), mas o contrato
-- não é específico dela, para permitir plugar outro parceiro no futuro
-- sem tocar na lógica de negócio.
-- ============================================================

alter table units
  add column if not exists recruiting_integration_mode text not null default 'native'
    check (recruiting_integration_mode in ('native', 'smarter')),
  add column if not exists smarter_recruiting_partner_token text,
  add column if not exists smarter_recruiting_company_id text;

comment on column units.recruiting_integration_mode is
  'native = pipeline de recrutamento próprio do Alizo (padrão, sem mudança de comportamento). smarter = vagas e candidatos sourced também são publicados no sistema de vagas da Smarter Estágios via smarter_recruiting_partner_token (lib/recruiter/smarter-recruiting-client.ts, atrás do contrato genérico lib/recruiter/partner-recruiting-client.ts).';
comment on column units.smarter_recruiting_partner_token is
  'Token de parceiro (Bearer) das rotas /api/partners/vacancies e /api/partners/applications da Smarter para esta unidade especificamente — segredo, nunca exposto ao client. Só é usado quando recruiting_integration_mode = ''smarter''. Marcado manualmente, sem UI ainda.';
comment on column units.smarter_recruiting_company_id is
  'id da Company desta unidade no Sistema Smarter — campo obrigatório do POST /api/partners/vacancies (companyId). Sem ele a integração smarter de recrutamento não consegue publicar vaga nenhuma, mesmo com token válido. Marcado manualmente, sem UI ainda.';

alter table job_openings
  add column if not exists smarter_recruiting_vacancy_id text;

comment on column job_openings.smarter_recruiting_vacancy_id is
  'id da vaga correspondente no sistema de vagas da Smarter (retornado pelo POST /api/partners/vacancies), usado para correlacionar as chamadas seguintes de POST /api/partners/applications. Null quando a unidade não usa integração smarter de recrutamento ou a criação ainda não ocorreu/falhou.';

alter table job_candidates
  add column if not exists smarter_recruiting_added_at timestamptz;

comment on column job_candidates.smarter_recruiting_added_at is
  'Quando este candidato foi adicionado à vaga correspondente no sistema de vagas da Smarter via POST /api/partners/applications (o candidato precisa ter sido sourced de lá — candidates.source = ''smarter_api'' — pois o endpoint espera o id de aluno retornado por /api/partners/candidates). Null = ainda não adicionado ou vaga não está no modo smarter.';
