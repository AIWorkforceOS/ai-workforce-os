-- ============================================================
-- Aceite de Termos de Uso / Política de Privacidade (2026-08-19)
--
-- Corrige o gap P0 da auditoria de 19/08: não existia NENHUM
-- mecanismo de aceite legal no cadastro self-service. A partir desta
-- migration, o checkout (app/api/checkout/complete/route.ts) exige e
-- registra o aceite de forma auditável antes de criar a conta.
--
-- O conteúdo jurídico em si (/terms, /privacy) é PROVISÓRIO até
-- aprovação — só a infraestrutura de versionamento/auditoria é
-- definitiva, pedido explícito de não inventar texto jurídico final
-- nesta tarefa.
-- ============================================================

create table if not exists legal_acceptances (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete set null,
  org_id uuid references organizations(id) on delete set null,
  terms_version text not null,
  privacy_version text not null,
  accepted_at timestamptz not null default now(),
  ip inet,
  region text,
  source text not null default 'checkout',
  created_at timestamptz not null default now()
);

create index if not exists legal_acceptances_user_idx on legal_acceptances(user_id);
create index if not exists legal_acceptances_org_idx on legal_acceptances(org_id);

alter table legal_acceptances enable row level security;

-- Registro de auditoria: só a equipe Alizo consulta (nunca o próprio
-- cliente via app — não há tela pra isso, é rastro interno/jurídico).
drop policy if exists legal_acceptances_all on legal_acceptances;
create policy legal_acceptances_all on legal_acceptances
  for all using (public.is_super_admin())
  with check (public.is_super_admin());
