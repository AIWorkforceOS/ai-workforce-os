-- Validação da migration 097 em TRANSAÇÃO DESFEITA (termina com RAISE EXCEPTION 'M097_OK ...'; nada é gravado).
-- Cole este arquivo inteiro (inclui o SQL da 097) numa única execução. Compara dono/ACL/corpo/SECURITY INVOKER antes e depois,
-- confere proconfig = search_path=public e exercita os gatilhos com search_path hostil (pg_temp).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create temp table _before on commit drop as
select p.proname, pg_get_userbyid(p.proowner) dono, p.prosecdef secdef, p.proacl::text acl, md5(p.prosrc) corpo, p.provolatile vol, p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('quote_set_updated_at','quote_drafts_guard_approved','quote_children_guard_approved');
alter function public.quote_set_updated_at() set search_path = public;
alter function public.quote_drafts_guard_approved() set search_path = public;
alter function public.quote_children_guard_approved() set search_path = public;
alter function public.quote_set_updated_at() set search_path = public;  -- idempotente
do $t$
declare
  b record; a record; n int := 0;
  v_org uuid; v_unit uuid; v_appt uuid; v_draft uuid; v_item uuid; v_new timestamptz;
begin
  for b in select * from _before loop
    select p.proname, pg_get_userbyid(p.proowner) dono, p.prosecdef secdef, p.proacl::text acl, md5(p.prosrc) corpo, p.provolatile vol, p.proconfig
      into a from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname=b.proname;
    if a.dono <> b.dono or a.secdef <> b.secdef or a.acl is distinct from b.acl or a.corpo <> b.corpo or a.vol <> b.vol then raise exception 'FAIL: % mudou', b.proname; end if;
    if a.proconfig is distinct from array['search_path=public'] then raise exception 'FAIL: % proconfig=%', b.proname, a.proconfig; end if;
    n := n + 1;
  end loop;
  if n <> 3 then raise exception 'FAIL: esperava 3 funções, achei %', n; end if;
  select u.org_id, a2.unit_id, a2.id into v_org, v_unit, v_appt from public.appointments a2 join public.units u on u.id=a2.unit_id where u.org_id is not null limit 1;
  insert into public.quote_drafts (org_id, unit_id, appointment_id, version) values (v_org, v_unit, v_appt, 9001) returning id into v_draft;
  insert into public.quote_items (draft_id, org_id, unit_id, appointment_id, name_en, quantity, unit) values (v_draft, v_org, v_unit, v_appt, 'item', 1, 'ea') returning id into v_item;
  set local search_path = pg_temp;
  update public.quote_drafts set tech_text_pt = 'editado', updated_at = '2000-01-01' where id = v_draft returning updated_at into v_new;
  if v_new <> now() then raise exception 'FAIL: gatilho updated_at não sobrescreveu'; end if;
  update public.quote_items set name_en = 'item 2' where id = v_item;
  reset search_path;
  perform public.approve_quote_draft(v_draft, null, '{}'::jsonb);
  set local search_path = pg_temp;
  begin update public.quote_items set name_en = 'hack' where id = v_item; raise exception 'FAIL: item aprovado alterado'; exception when sqlstate '42501' then null; end;
  begin delete from public.quote_items where id = v_item; raise exception 'FAIL: item aprovado apagado'; exception when sqlstate '42501' then null; end;
  begin update public.quote_drafts set tech_text_pt = 'hack' where id = v_draft; raise exception 'FAIL: rascunho aprovado alterado'; exception when sqlstate '42501' then null; end;
  begin delete from public.quote_drafts where id = v_draft; raise exception 'FAIL: rascunho aprovado apagado'; exception when sqlstate '42501' then null; end;
  update public.quote_drafts set commercial_status = 'sent' where id = v_draft;
  reset search_path;
  raise exception 'M097_OK dono/ACL/corpo/INVOKER idênticos; search_path fixado; gatilhos OK com search_path hostil; imutabilidade preservada';
end;
$t$;
