-- ============================================================
-- AI Workforce OS — Migration 21: exclusão de organização (super admin)
--
-- Hard delete real, numa única transação (função em vez de dois DELETEs
-- soltos do client, que não seriam atômicos via PostgREST).
--
-- IMPORTANTE: units.org_id é "on delete set null" (não cascade) — um
-- DELETE direto em organizations órfã as unidades em vez de apagá-las,
-- e tudo que só referencia unit_id (leads, conversations, prospecting_jobs,
-- agent_configs, job_openings, candidates via unit_id, ad_accounts, etc.)
-- ficaria pendurado. Por isso apagamos units primeiro (cascade cobre esses
-- casos) e só depois organizations (cascade cobre users, employees,
-- financial_records, job_openings/candidates via org_id, ad_accounts via
-- org_id, recruiter_decisions/events via org_id, etc.).
--
-- api_usage_events.org_id/unit_id são "on delete set null" de propósito:
-- é log de billing/uso, não dado de cliente — fica órfão em vez de apagado.
-- ============================================================

create or replace function public.admin_delete_organization(target_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org organizations%rowtype;
  v_counts jsonb;
  v_actor text;
begin
  if not public.is_super_admin() then
    raise exception 'apenas super_admin pode excluir organizações';
  end if;

  select * into v_org from organizations where id = target_org_id;
  if not found then
    raise exception 'organização não encontrada';
  end if;

  v_actor := coalesce(auth.jwt() ->> 'email', 'unknown');

  select jsonb_build_object(
    'units', (select count(*) from units where org_id = target_org_id),
    'leads', (select count(*) from leads where unit_id in (select id from units where org_id = target_org_id)),
    'conversations', (select count(*) from conversations where unit_id in (select id from units where org_id = target_org_id)),
    'prospecting_jobs', (select count(*) from prospecting_jobs where unit_id in (select id from units where org_id = target_org_id)),
    'users', (select count(*) from users where org_id = target_org_id),
    'employees', (select count(*) from employees where org_id = target_org_id),
    'job_openings', (select count(*) from job_openings where org_id = target_org_id),
    'candidates', (select count(*) from candidates where org_id = target_org_id),
    'ad_accounts', (select count(*) from ad_accounts where org_id = target_org_id),
    'financial_records', (select count(*) from financial_records where org_id = target_org_id)
  ) into v_counts;

  -- 1) unidades primeiro — cascade cuida de leads/conversations/
  --    prospecting_jobs/agent_configs/job_openings/job_candidates/
  --    candidate_messages/ad_accounts/ad_entities/ad_metrics_snapshots/
  --    traffic_decisions/ad_actions_log/traffic_reports (unit_id).
  delete from units where org_id = target_org_id;

  -- 2) organização — cascade cuida de users/employees/financial_records/
  --    job_openings/candidates/recruiter_decisions/recruiter_events/
  --    company_recruiting_profiles/ad_accounts/traffic_decisions/... (org_id).
  delete from organizations where id = target_org_id;

  -- Auditoria depois da exclusão (org_id null — a organização já não existe;
  -- se inserido antes, o próprio cascade do passo 2 apagaria este registro).
  insert into system_events (org_id, unit_id, level, source, event_type, message, metadata)
  values (
    null, null, 'warning', 'system', 'organization_deleted',
    format('Organização "%s" (%s) excluída por %s.', v_org.name, v_org.slug, v_actor),
    jsonb_build_object(
      'deleted_org_id', v_org.id,
      'name', v_org.name,
      'slug', v_org.slug,
      'plan', v_org.plan,
      'owner_email', v_org.owner_email,
      'counts', v_counts,
      'deleted_by_email', v_actor
    )
  );

  return v_counts;
end;
$$;

grant execute on function public.admin_delete_organization(uuid) to authenticated;
