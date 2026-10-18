-- Verificação do orçamento de IA (migrations 094/095). SEMPRE termina com RAISE EXCEPTION: nada é gravado.
-- Uso: depois das migrations 093–096 (ou, antes de aplicá-las, dentro de uma transação desfeita junto com o SQL da 095 e um stub de quote_analysis_jobs).
-- Em sucesso a mensagem de erro final começa com "VERIFY_OK" e traz o relatório; qualquer falha começa com "FAIL:".
do $verify$
declare
  v_org uuid; v_unit uuid; v_appt uuid;
  v_job1 uuid; v_job2 uuid; v_job3 uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid;
  v_ok boolean;
  v_n integer;
  j public.quote_analysis_jobs%rowtype;
  v_report text := '';
  v_denied boolean;
  rep record;
begin
  -- usa uma ordem REAL só como âncora das chaves estrangeiras (nada é gravado nela; tudo é desfeito)
  select u.org_id, a.unit_id, a.id into v_org, v_unit, v_appt from public.appointments a join public.units u on u.id = a.unit_id where u.org_id is not null limit 1;
  if v_org is null then raise exception 'FAIL: sem ordem/unidade para ancorar o teste'; end if;

  -- jobs de teste (em execução, lease válido)
  insert into public.quote_analysis_jobs (id, org_id, unit_id, appointment_id, status, locked_until, idempotency_key) values
    (uuid_generate_v4(), v_org, v_unit, v_appt, 'running', now() + interval '5 minutes', 'v-1') returning id into v_job1;
  insert into public.quote_analysis_jobs (id, org_id, unit_id, appointment_id, status, locked_until, idempotency_key) values
    (uuid_generate_v4(), v_org, v_unit, v_appt, 'running', now() + interval '5 minutes', 'v-2') returning id into v_job2;
  insert into public.quote_analysis_jobs (id, org_id, unit_id, appointment_id, status, locked_until, idempotency_key) values
    (uuid_generate_v4(), v_org, v_unit, v_appt, 'running', now() + interval '5 minutes', 'v-3') returning id into v_job3;

  -- 1) reservar devolve id; liquidar é idempotente
  r1 := public.reserve_quote_budget(v_job1, 0.20);
  if r1 is null then raise exception 'FAIL: 1 reserva deveria caber'; end if;
  v_ok := public.settle_quote_budget(r1, 0.05, 100, 50);
  if not v_ok then raise exception 'FAIL: 1 liquidar'; end if;
  v_ok := public.settle_quote_budget(r1, 0.05, 100, 50);
  if v_ok then raise exception 'FAIL: 1 liquidação repetida cobrou de novo'; end if;
  select * into j from public.quote_analysis_jobs where id = v_job1;
  if j.spent_usd <> 0.05 or j.reserved_usd <> 0 or j.unconfirmed_usd <> 0 or j.ai_calls <> 1 then raise exception 'FAIL: 1 baldes spent=% reserved=% unconf=% calls=%', j.spent_usd, j.reserved_usd, j.unconfirmed_usd, j.ai_calls; end if;
  v_report := v_report || '1 reservar/liquidar idempotente OK; ';

  -- 2) teto por cotação conta os 3 baldes: 0,05 confirmado + 0,40 não confirmado = 0,45; 0,16 não cabe, 0,15 cabe
  r2 := public.reserve_quote_budget(v_job1, 0.40);
  v_ok := public.mark_quote_reservation_unconfirmed(r2, 'timeout');
  if not v_ok then raise exception 'FAIL: 2 marcar não confirmada'; end if;
  if public.reserve_quote_budget(v_job1, 0.16) is not null then raise exception 'FAIL: 2 passou do teto de 0,60 com não confirmado'; end if;
  r3 := public.reserve_quote_budget(v_job1, 0.15);
  if r3 is null then raise exception 'FAIL: 2 0,15 deveria caber'; end if;
  select * into j from public.quote_analysis_jobs where id = v_job1;
  if j.spent_usd <> 0.05 or j.reserved_usd <> 0.15 or j.unconfirmed_usd <> 0.40 then raise exception 'FAIL: 2 baldes % % %', j.spent_usd, j.reserved_usd, j.unconfirmed_usd; end if;
  -- não confirmada não pode ser liberada nem marcada de novo
  if public.release_quote_budget(r2) then raise exception 'FAIL: 2 liberou reserva não confirmada'; end if;
  if public.mark_quote_reservation_unconfirmed(r2) then raise exception 'FAIL: 2 remarcou'; end if;
  v_report := v_report || '2 teto soma 3 baldes OK; ';

  -- 3) liberar só reserva ativa; idempotente
  if not public.release_quote_budget(r3, 'sem cobrança') then raise exception 'FAIL: 3 liberar'; end if;
  if public.release_quote_budget(r3) then raise exception 'FAIL: 3 liberou duas vezes'; end if;
  select * into j from public.quote_analysis_jobs where id = v_job1;
  if j.reserved_usd <> 0 then raise exception 'FAIL: 3 reservado %', j.reserved_usd; end if;
  v_report := v_report || '3 liberar OK; ';

  -- 4) reconciliar com custo real: 0,40 preventivo -> 0,02 real; idempotente; só "unconfirmed"
  if not public.reconcile_quote_reservation(r2, 0.02, 'relatório OpenAI') then raise exception 'FAIL: 4 reconciliar'; end if;
  if public.reconcile_quote_reservation(r2, 0.02) then raise exception 'FAIL: 4 reconciliou duas vezes'; end if;
  select * into j from public.quote_analysis_jobs where id = v_job1;
  if j.unconfirmed_usd <> 0 or j.spent_usd <> 0.07 then raise exception 'FAIL: 4 baldes unconf=% spent=%', j.unconfirmed_usd, j.spent_usd; end if;
  v_report := v_report || '4 reconciliar OK; ';

  -- 5) lease vencido: o próximo claim torna a reserva ativa NÃO CONFIRMADA (não gasto)
  r1 := public.reserve_quote_budget(v_job2, 0.30);
  update public.quote_analysis_jobs set locked_until = now() - interval '1 minute' where id = v_job2;
  select count(*) into v_n from public.claim_quote_job(v_job2, 'w2', 300);
  if v_n <> 1 then raise exception 'FAIL: 5 claim devolveu % linhas', v_n; end if;
  select * into j from public.quote_analysis_jobs where id = v_job2;
  if j.spent_usd <> 0 or j.reserved_usd <> 0 or j.unconfirmed_usd <> 0.30 then raise exception 'FAIL: 5 baldes % % %', j.spent_usd, j.reserved_usd, j.unconfirmed_usd; end if;
  -- worker lento responde depois: estimativa vira custo real, sem duplicar
  if not public.settle_quote_budget(r1, 0.04, 1, 1) then raise exception 'FAIL: 5 liquidação tardia'; end if;
  select * into j from public.quote_analysis_jobs where id = v_job2;
  if j.spent_usd <> 0.04 or j.unconfirmed_usd <> 0 then raise exception 'FAIL: 5 pós-tardia % %', j.spent_usd, j.unconfirmed_usd; end if;
  v_report := v_report || '5 claim/liquidação tardia OK; ';

  -- 6) varredura: reserva ativa antiga em job terminado vira não confirmada; recente é poupada
  r1 := public.reserve_quote_budget(v_job3, 0.25);
  update public.quote_analysis_jobs set status = 'failed', locked_until = null where id = v_job3;
  if public.reconcile_quote_budgets(10) <> 0 then raise exception 'FAIL: 6 varreu reserva recente'; end if;
  update public.quote_budget_reservations set created_at = now() - interval '20 minutes' where id = r1;
  if public.reconcile_quote_budgets(10) <> 1 then raise exception 'FAIL: 6 não varreu reserva antiga'; end if;
  select * into j from public.quote_analysis_jobs where id = v_job3;
  if j.spent_usd <> 0 or j.reserved_usd <> 0 or j.unconfirmed_usd <> 0.25 then raise exception 'FAIL: 6 baldes % % %', j.spent_usd, j.reserved_usd, j.unconfirmed_usd; end if;
  if public.reconcile_quote_budgets(10) <> 0 then raise exception 'FAIL: 6 varredura não é idempotente'; end if;
  v_report := v_report || '6 varredura OK; ';

  -- 7) job parado/terminado não reserva
  if public.reserve_quote_budget(v_job3, 0.01) is not null then raise exception 'FAIL: 7 job terminado reservou'; end if;

  -- 8) teto mensal pelo razão (+ relatório por balde)
  insert into public.quote_org_limits (org_id, monthly_cap_usd) values (v_org, 0.60)
    on conflict (org_id) do update set monthly_cap_usd = 0.60;
  select * into rep from public.quote_org_budget_report(v_org);
  -- mês já tem: confirmado 0,07+0,04; não confirmado 0,25 => 0,36 no total (organização de teste sem outros gastos)
  if abs(rep.confirmed_usd - 0.11) > 0.000001 or abs(rep.unconfirmed_usd - 0.25) > 0.000001 or abs(rep.total_usd - 0.36) > 0.000001 then
    raise exception 'FAIL: 8 relatório conf=% unconf=% total=%', rep.confirmed_usd, rep.unconfirmed_usd, rep.total_usd; end if;
  update public.quote_analysis_jobs set status = 'running', locked_until = now() + interval '5 minutes' where id = v_job2;
  if public.reserve_quote_budget(v_job2, 0.25) is not null then raise exception 'FAIL: 8 passou do teto mensal'; end if;
  r4 := public.reserve_quote_budget(v_job2, 0.24);
  if r4 is null then raise exception 'FAIL: 8 0,24 deveria caber'; end if;
  v_report := v_report || format('8 teto mensal OK (conf=%s ativo=%s unconf=%s); ', rep.confirmed_usd, rep.active_usd, rep.unconfirmed_usd);

  -- 9) permissões: navegador (authenticated/anon) não executa nada; service_role executa
  set local role authenticated;
  v_denied := false;
  begin perform public.reserve_quote_budget(v_job2, 0.01); exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then reset role; raise exception 'FAIL: 9 authenticated executou reserve'; end if;
  v_denied := false;
  begin perform public.settle_quote_budget(r4, 0, 0, 0); exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then reset role; raise exception 'FAIL: 9 authenticated executou settle'; end if;
  v_denied := false;
  begin perform public.reconcile_quote_reservation(r4, 0, null); exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then reset role; raise exception 'FAIL: 9 authenticated executou reconcile'; end if;
  v_denied := false;
  begin perform public.quote_org_budget_report(v_org); exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then reset role; raise exception 'FAIL: 9 authenticated leu o relatório'; end if;
  begin
    select count(*) into v_n from public.quote_budget_reservations;
    if v_n <> 0 then reset role; raise exception 'FAIL: 9 authenticated leu % reservas (RLS sem policy deveria dar 0)', v_n; end if;
  exception when insufficient_privilege then null;  -- sem privilégio de tabela também é negação
  end;
  reset role;
  set local role anon;
  v_denied := false;
  begin perform public.reserve_quote_budget(v_job2, 0.01); exception when insufficient_privilege then v_denied := true; end;
  reset role;
  if not v_denied then raise exception 'FAIL: 9 anon executou reserve'; end if;
  set local role service_role;
  perform public.quote_org_month_spend(v_org);
  reset role;

  raise exception 'VERIFY_OK 1 reservar/liquidar idempotente; 2 teto soma 3 baldes; 3 liberar; 4 reconciliar; 5 claim+liquidação tardia; 6 varredura; 7 job terminado; 8 teto mensal (conf=% ativo=% unconf=% total=%); 9 permissões (authenticated/anon negados, RLS 0 linhas, service_role ok)', rep.confirmed_usd, rep.active_usd, rep.unconfirmed_usd, rep.total_usd;
end;
$verify$;
