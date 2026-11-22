-- Partner integration tables are server-only. Keep RLS fail-closed and remove
-- the broad grants inherited from Supabase's legacy public-schema defaults.
revoke all on table public.partner_api_keys from anon, authenticated;
revoke all on table public.partner_events from anon, authenticated;
revoke all on table public.partner_optouts from anon, authenticated;
revoke all on table public.partner_org_templates from anon, authenticated;
revoke all on table public.partner_webhook_deliveries from anon, authenticated;
revoke all on table public.partner_webhook_endpoints from anon, authenticated;

-- Explicit deny policies document the intended access model and keep the
-- database linter from treating the fail-closed server-only tables as an
-- accidental omission. The service role bypasses RLS as expected.
drop policy if exists partner_api_keys_server_only on public.partner_api_keys;
create policy partner_api_keys_server_only on public.partner_api_keys
  as restrictive for all to anon, authenticated
  using (false) with check (false);

drop policy if exists partner_events_server_only on public.partner_events;
create policy partner_events_server_only on public.partner_events
  as restrictive for all to anon, authenticated
  using (false) with check (false);

drop policy if exists partner_optouts_server_only on public.partner_optouts;
create policy partner_optouts_server_only on public.partner_optouts
  as restrictive for all to anon, authenticated
  using (false) with check (false);

drop policy if exists partner_org_templates_server_only on public.partner_org_templates;
create policy partner_org_templates_server_only on public.partner_org_templates
  as restrictive for all to anon, authenticated
  using (false) with check (false);

drop policy if exists partner_webhook_deliveries_server_only on public.partner_webhook_deliveries;
create policy partner_webhook_deliveries_server_only on public.partner_webhook_deliveries
  as restrictive for all to anon, authenticated
  using (false) with check (false);

drop policy if exists partner_webhook_endpoints_server_only on public.partner_webhook_endpoints;
create policy partner_webhook_endpoints_server_only on public.partner_webhook_endpoints
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- SECURITY DEFINER functions do not inherit RLS protection. PostgreSQL grants
-- EXECUTE to PUBLIC by default, which also made these helpers and financial
-- RPCs callable by anonymous requests. Preserve authenticated/server use but
-- remove anonymous and implicit PUBLIC execution.
revoke execute on function public.consolidate_invoices(uuid, uuid, uuid[], text, date) from public, anon;
revoke execute on function public.current_app_employee_id() from public, anon;
revoke execute on function public.current_app_role() from public, anon;
revoke execute on function public.current_app_unit_id() from public, anon;
revoke execute on function public.current_app_user_id() from public, anon;
revoke execute on function public.current_job_role() from public, anon;
revoke execute on function public.current_org_id() from public, anon;
revoke execute on function public.generate_client_invoice(uuid, text, uuid[], text, date, text) from public, anon;
revoke execute on function public.generate_service_records_invoice(uuid, uuid, uuid[], text, date, text, date) from public, anon;
revoke execute on function public.quote_draft_visible_to_caller(uuid, uuid) from public, anon;
revoke execute on function public.register_service_record_payment(uuid, numeric, text) from public, anon;
revoke execute on function public.unit_org_id(uuid) from public, anon;
