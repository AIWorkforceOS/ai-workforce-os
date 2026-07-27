-- ============================================================
-- AI Workforce OS — Migration 46: intake de candidato independente
-- da Smarter (auditoria interna, gap de confiança fase 3/3)
--
-- Hoje a ÚNICA fonte de candidatos do Recruiter Employee é a API da
-- Smarter (candidates.source = 'smarter_api', via
-- units.smarter_recruiting_partner_token/smarter_recruiting_company_id,
-- ligado manualmente por alguém da Alizo). Para qualquer organização
-- que não seja parceira da Smarter (a maioria), abrir uma vaga produz
-- um funil de triagem elegante e zero candidatos para sempre.
--
-- Esta migration é só a infraestrutura de dados para duas novas fontes
-- ADITIVAS de entrada no MESMO pipeline (job_candidates / scoring
-- rubric já existentes — lib/recruiter/candidate-intake.ts):
--
--   1. job_openings.public_application_token — mesma receita de
--      units.public_lead_intake_token (migration 022): token de baixo
--      risco, sem login, um por vaga, só permite criar uma candidatura
--      simples (nome/contato/currículo) para ESSA vaga. Se vazar, o
--      pior caso é uma candidatura indevida.
--   2. Bucket de Storage 'candidate-resumes' para o PDF do currículo,
--      vinculado ao candidato — cadastro manual (dono/RH) ou
--      candidatura pública. Diferente de employee-attachments/
--      content-media (públicos, pois precisam ser buscados direto por
--      URL pelo WhatsApp/e-mail), currículo é dado pessoal (LGPD) só
--      consultado pelo dono/RH da própria organização no dashboard —
--      por isso o bucket é PRIVADO, com RLS por is_org_member/
--      is_org_admin (candidates é escopado por org_id, não unit_id).
--
-- candidates.source já aceita qualquer texto livre (comentário original:
-- "smarter_api | indeed | infojobs | manual | referral") — não há CHECK
-- constraint, então os novos valores 'manual' (já previsto) e
-- 'public_application' não exigem alteração de coluna.
-- ============================================================

alter table job_openings
  add column if not exists public_application_token uuid not null default gen_random_uuid();

create unique index if not exists job_openings_public_application_token_idx
  on job_openings(public_application_token);

comment on column job_openings.public_application_token is
  'Token público de baixo risco para a página /vaga/[token] e POST /api/public/job-application/[token] — permite candidatura externa (nome/contato/currículo) só para ESTA vaga, sem login. Mesmo padrão de risco de units.public_lead_intake_token (migration 022). Se vazar, o pior caso é uma candidatura indevida nesta vaga.';

-- ------------------------------------------------------------
-- STORAGE: bucket privado para currículos de candidatos
--
-- Caminho dos arquivos: {org_id}/{filename} — mesmo padrão de pasta
-- por tenant de unit-logos/employee-attachments, mas aqui a raiz é
-- org_id (candidates.org_id) porque candidates não tem unit_id.
-- Privado: sem leitura pública, só membros autenticados da própria
-- org (dashboard). Escrita (upload) é feita ou pelo dono/RH autenticado
-- (cadastro manual) ou pela service role no endpoint público de
-- candidatura (que já validou o token da vaga antes de fazer upload).
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('candidate-resumes', 'candidate-resumes', false)
on conflict (id) do nothing;

drop policy if exists candidate_resumes_select on storage.objects;
create policy candidate_resumes_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'candidate-resumes'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists candidate_resumes_write on storage.objects;
create policy candidate_resumes_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'candidate-resumes'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
    and public.is_org_admin()
  );

drop policy if exists candidate_resumes_update on storage.objects;
create policy candidate_resumes_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'candidate-resumes'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
    and public.is_org_admin()
  );

drop policy if exists candidate_resumes_delete on storage.objects;
create policy candidate_resumes_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'candidate-resumes'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
    and public.is_org_admin()
  );
