-- Planejamento semanal do Gestor de Conteúdo (pedido do Vinicius, 2026-08-23):
-- o funcionário gera os posts da semana toda de uma vez, cada um com o
-- dia em que deve ir ao ar (ex: seg/qua/sex). Reaproveita
-- content_posts.scheduled_for (timestamptz, existe desde a migration 040
-- mas nunca tinha sido usado em lugar nenhum) em vez de criar uma coluna
-- nova. Aprovar um post com scheduled_for no futuro só marca 'approved',
-- sem publicar — quem publica de fato na data certa é o cron diário (ver
-- api/cron/content/route.ts, fase de publicação agendada). Null continua
-- significando "hoje/assim que aprovado" (fluxo avulso antigo, sem
-- mudança de comportamento pra quem não usa planejamento semanal).
comment on column content_posts.scheduled_for is
  'Dia/hora em que o post deve ir ao ar (planejamento semanal). Aprovar um post com scheduled_for no futuro só marca approved, sem publicar — quem publica de fato na data certa é o cron diário. Null = fluxo avulso antigo (publica assim que aprovado).';

create index if not exists content_posts_scheduled_for_idx
  on content_posts(unit_id, scheduled_for)
  where scheduled_for is not null;
