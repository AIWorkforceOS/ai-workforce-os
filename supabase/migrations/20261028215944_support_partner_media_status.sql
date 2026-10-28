-- Segunda fase do suporte entre sistemas: resultado final auditável e
-- consulta server-side pelo parceiro. Mídias não são persistidas em base64;
-- somente a transcrição/descrição técnica entra no histórico do chamado.
alter table public.support_cases
  add column resolution text,
  add column resolution_updated_at timestamptz;

drop index if exists public.support_cases_external_reference_uq;
create unique index support_cases_external_reference_uq
  on public.support_cases(source_system, org_id, external_reference)
  where external_reference is not null;

comment on column public.support_cases.resolution is
  'Resposta final segura para o cliente, publicada após resolução humana do chamado.';
