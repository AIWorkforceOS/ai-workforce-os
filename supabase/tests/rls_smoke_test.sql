-- ============================================================
-- Teste de isolamento multi-tenant (RLS)
--
-- Como usar: rode este script no SQL Editor do Supabase DEPOIS
-- de aplicar as migrations 4 e 5. Ele cria uma org fictícia
-- ("Org Teste B") com unidade, lead e usuário, e simula um JWT
-- desse usuário para verificar que ele NÃO enxerga dados de
-- outras orgs. No final, faz rollback de tudo.
-- ============================================================

begin;

-- 1. Cria a org B fictícia com unidade + lead + usuário
insert into organizations (id, name, slug, plan, owner_email)
values ('00000000-0000-4000-a000-000000000001', 'Org Teste B', 'org-teste-b-rls', 'starter', 'cliente-b@teste.dev');

insert into users (org_id, email, name, role)
values ('00000000-0000-4000-a000-000000000001', 'cliente-b@teste.dev', 'Cliente B', 'admin');

insert into units (id, org_id, name, slug)
values ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 'Unidade B', 'unidade-b-rls');

insert into leads (id, unit_id, company_name, source, status)
values ('00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000002', 'Lead da Org B', 'manual', 'new');

-- Dados do Recruiter (migration 8): vaga + candidato da Org B
insert into job_openings (id, org_id, unit_id, lead_id, title)
values ('00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000003', 'Vaga da Org B');

insert into candidates (id, org_id, name, source)
values ('00000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000001', 'Candidato da Org B', 'manual');

-- 2. Simula um usuário autenticado da Org B
set local role authenticated;
set local request.jwt.claims = '{"email": "cliente-b@teste.dev", "role": "authenticated"}';

-- 3. Verificações — todas devem passar (erro = política vazando dados)
do $$
declare
  total_orgs int;
  total_units int;
  foreign_leads int;
  own_leads int;
begin
  select count(*) into total_orgs from organizations;
  if total_orgs <> 1 then
    raise exception 'FALHA: usuário da Org B enxerga % organizações (esperado: 1)', total_orgs;
  end if;

  select count(*) into total_units from units where org_id <> '00000000-0000-4000-a000-000000000001';
  if total_units <> 0 then
    raise exception 'FALHA: usuário da Org B enxerga % unidades de outras orgs', total_units;
  end if;

  select count(*) into foreign_leads
  from leads where unit_id <> '00000000-0000-4000-a000-000000000002';
  if foreign_leads <> 0 then
    raise exception 'FALHA: usuário da Org B enxerga % leads de outras orgs', foreign_leads;
  end if;

  select count(*) into own_leads
  from leads where unit_id = '00000000-0000-4000-a000-000000000002';
  if own_leads <> 1 then
    raise exception 'FALHA: usuário da Org B deveria ver o próprio lead (viu %)', own_leads;
  end if;

  raise notice 'OK: isolamento multi-tenant funcionando — Org B só enxerga os próprios dados.';
end $$;

-- 3b. Verificações do Recruiter (job_openings / candidates)
do $$
declare
  foreign_jobs int;
  own_jobs int;
  foreign_candidates int;
  own_candidates int;
begin
  select count(*) into foreign_jobs
  from job_openings where org_id <> '00000000-0000-4000-a000-000000000001';
  if foreign_jobs <> 0 then
    raise exception 'FALHA: usuário da Org B enxerga % vagas de outras orgs', foreign_jobs;
  end if;

  select count(*) into own_jobs
  from job_openings where org_id = '00000000-0000-4000-a000-000000000001';
  if own_jobs <> 1 then
    raise exception 'FALHA: usuário da Org B deveria ver a própria vaga (viu %)', own_jobs;
  end if;

  select count(*) into foreign_candidates
  from candidates where org_id <> '00000000-0000-4000-a000-000000000001';
  if foreign_candidates <> 0 then
    raise exception 'FALHA: usuário da Org B enxerga % candidatos de outras orgs', foreign_candidates;
  end if;

  select count(*) into own_candidates
  from candidates where org_id = '00000000-0000-4000-a000-000000000001';
  if own_candidates <> 1 then
    raise exception 'FALHA: usuário da Org B deveria ver o próprio candidato (viu %)', own_candidates;
  end if;

  raise notice 'OK: isolamento do Recruiter funcionando — vagas e candidatos não vazam entre orgs.';
end $$;

-- 4. Limpa tudo (nada é persistido)
rollback;
