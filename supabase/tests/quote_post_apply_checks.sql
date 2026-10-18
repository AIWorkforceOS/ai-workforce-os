-- VERIFICAÇÃO PÓS-APLICAÇÃO das migrations 093–096. Termina SEMPRE com RAISE EXCEPTION (nada é gravado).
-- Sucesso = mensagem "POST_OK ...". Falha = "FAIL: ...".
-- Cobre: objetos existem, RLS ligado, funções só do service_role, técnico/anon sem acesso (inclusive a tarifas), colunas monetárias ausentes no plano de mão de obra.
do $post$
declare
  v_t text; v_f text; v_denied boolean; v_n bigint;
  v_tables text[] := array['quote_rate_cards','quote_analysis_jobs','quote_drafts','quote_items','quote_item_options','quote_labor_plan','quote_draft_media','quote_commercial','quote_events','quote_org_limits','product_price_cache','quote_budget_reservations'];
  v_funcs text[] := array['claim_next_quote_job','claim_quote_job','quote_org_month_spend','quote_org_budget_report','reserve_quote_budget','settle_quote_budget','release_quote_budget','mark_quote_reservation_unconfirmed','reconcile_quote_reservation','reconcile_quote_budgets','quote_expire_job_reservations'];
begin
  foreach v_t in array v_tables loop
    if not exists (select 1 from information_schema.tables where table_schema='public' and table_name=v_t) then raise exception 'FAIL: tabela % não existe', v_t; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || v_t)::regclass) then raise exception 'FAIL: RLS desligado em %', v_t; end if;
  end loop;

  foreach v_f in array v_funcs loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=v_f) then raise exception 'FAIL: função % não existe', v_f; end if;
    -- nenhuma sobrecarga executável por public/anon/authenticated
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname=v_f
                  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) then
      raise exception 'FAIL: função % executável por anon/authenticated', v_f;
    end if;
    if v_f <> 'quote_expire_job_reservations' and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=v_f and has_function_privilege('service_role', p.oid, 'execute')) then
      raise exception 'FAIL: service_role não executa %', v_f;
    end if;
  end loop;

  -- plano de mão de obra NÃO pode ter coluna monetária
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='quote_labor_plan' and column_name ~* '(rate|price|cost|usd|pay|margin|markup|amount|dollar|micros|billed|billing)') then
    raise exception 'FAIL: quote_labor_plan tem coluna monetária';
  end if;
  -- default seguro: nenhuma unidade com o módulo ligado
  select count(*) into v_n from public.units where quote_ai_team_mode <> 'off';
  if v_n <> 0 then raise exception 'FAIL: % unidade(s) com módulo ligado logo após aplicar', v_n; end if;

  -- navegador (authenticated/anon) lê 0 linhas das tabelas administrativas (ou é negado)
  foreach v_t in array array['quote_rate_cards','quote_analysis_jobs','quote_commercial','quote_events','quote_budget_reservations','product_price_cache'] loop
    foreach v_f in array array['authenticated','anon'] loop
      execute format('set local role %I', v_f);
      v_denied := false;
      begin
        execute format('select count(*) from public.%I', v_t) into v_n;
        if v_n <> 0 then reset role; raise exception 'FAIL: % leu % linhas de %', v_f, v_n, v_t; end if;
      exception when insufficient_privilege then v_denied := true;
      end;
      reset role;
    end loop;
  end loop;

  raise exception 'POST_OK: % tabelas com RLS, % funções só do service_role, plano de mão de obra sem coluna monetária, nenhuma unidade ligada, authenticated/anon sem acesso às camadas administrativas', array_length(v_tables,1), array_length(v_funcs,1);
end;
$post$;
-- Obs.: o teste de RLS por PAPEL de empresa (técnico x admin, com claims JWT reais) segue o roteiro do runbook (seção "Permissões por papel").
