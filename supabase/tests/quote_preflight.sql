-- PRÉ-CHECAGEM das migrations 093–096 — SOMENTE LEITURA (nenhum DDL, nenhuma escrita). Rodar imediatamente antes de aplicar.
-- Todas as linhas devem vir com ok = true. Qualquer false: NÃO aplicar; investigar.
select 'versão do Postgres >= 15' as check, current_setting('server_version_num')::int >= 150000 as ok, current_setting('server_version') as detail
union all select 'extensão uuid-ossp', exists (select 1 from pg_extension where extname = 'uuid-ossp'), null
union all select 'funções de RLS existem', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('is_org_admin','is_org_member','can_access_unit','is_super_admin')) = 4, null
union all select 'papel service_role existe', exists (select 1 from pg_roles where rolname = 'service_role'), null
union all select 'tabelas pai existem (organizations, units, appointments, employees)', (select count(*) from information_schema.tables where table_schema='public' and table_name in ('organizations','units','appointments','employees')) = 4, null
union all select 'módulo AINDA NÃO aplicado (0 tabelas quote_*)', (select count(*) from information_schema.tables where table_schema='public' and table_name like 'quote\_%') = 0, null
union all select 'sem coluna units.quote_ai_team_mode', not exists (select 1 from information_schema.columns where table_schema='public' and table_name='units' and column_name='quote_ai_team_mode'), null
union all select 'sem funções de orçamento antigas', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%quote_budget%' or p.proname like 'claim%quote%' or p.proname like 'reconcile_quote%')) = 0, null
union all select 'nenhuma transação longa segurando appointments/units (> 30 s)', not exists (
    select 1 from pg_stat_activity where state in ('active','idle in transaction') and xact_start < now() - interval '30 seconds' and pid <> pg_backend_pid() and datname = current_database()), 
    (select coalesce(string_agg(application_name || ' ' || (now() - xact_start)::text, '; '), 'nenhuma') from pg_stat_activity where xact_start is not null and pid <> pg_backend_pid() and xact_start < now() - interval '30 seconds')
union all select 'referência de linhas (para comparar depois): units=' || (select count(*) from units) || ' appointments=' || (select count(*) from appointments), true, md5((select string_agg(id::text || coalesce(updated_at::text,''), ',' order by id) from appointments))
;
-- Guarde a última linha (contagens + hash de appointments): o pós-aplicação deve dar EXATAMENTE o mesmo hash.
