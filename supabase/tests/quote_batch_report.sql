-- Relatório do LOTE do piloto (SOMENTE LEITURA — nenhum insert/update/delete). Rode no SQL editor ou via execute_sql.
-- Resume: nº de cotações, estados, gasto agregado vs. teto, custo médio e máximo por cotação, rodadas, e violações de teto.
with j as (
  select * from public.quote_analysis_jobs
  where unit_id = (select id from public.units where name = 'Mawi Pro — Principal' limit 1)
)
select
  count(*)                                                        as cotacoes,
  count(*) filter (where status in ('completed','awaiting_review')) as concluidas,
  count(*) filter (where status = 'needs_input')                  as aguardando_informacao,
  count(*) filter (where status in ('failed','cancelled'))        as falhas_ou_canceladas,
  round(coalesce(sum(spent_usd),0), 4)                            as gasto_agregado_usd,
  round(coalesce(avg(spent_usd),0), 4)                            as custo_medio_usd,
  round(coalesce(max(spent_usd),0), 4)                            as custo_maximo_usd,
  count(*) filter (where spent_usd > 0.60)                        as acima_de_060_deveria_ser_0,
  count(*) filter (where coalesce(unconfirmed_usd,0) > 0)         as com_custo_nao_confirmado,
  coalesce(sum(rounds),0)                                         as rodadas_total,
  coalesce(sum(ai_calls),0)                                       as chamadas_ia,
  (select pilot_max_quotes from public.quote_org_limits l join public.units u on u.org_id = l.org_id where u.name = 'Mawi Pro — Principal' limit 1) as limite_cotacoes_lote,
  (select monthly_cap_usd   from public.quote_org_limits l join public.units u on u.org_id = l.org_id where u.name = 'Mawi Pro — Principal' limit 1) as teto_usd_lote
from j;

-- Por cotação (mais recentes primeiro)
select a.id as ordem, j.status, j.stage, j.rounds, round(j.spent_usd,4) as gasto_usd, round(j.budget_usd,2) as teto_usd, j.ai_calls, j.error_code, j.created_at
from public.quote_analysis_jobs j join public.appointments a on a.id = j.appointment_id
order by j.created_at desc limit 50;
