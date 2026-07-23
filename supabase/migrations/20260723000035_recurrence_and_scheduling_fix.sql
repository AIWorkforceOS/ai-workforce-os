-- ============================================================
-- AI Workforce OS — Migration 35: Recorrência ampliada + agenda utilizável
--
-- Pedido do Vinicius (2026-07-23): a recorrência semanal simples da
-- migration 032 não bastava — precisa de quinzenal, mensal e
-- personalizada (2+ vezes por semana, ex.: segunda e quinta). E a
-- agenda não deveria exigir configuração extra depois de cadastrar
-- cliente + colaborador: o bloqueio real era is_schedulable nascendo
-- false pra todo funcionário novo (migration 026), inclusive técnicos
-- — cuja função É atender agenda por definição.
--
--   appointments.recurrence — enum ampliado de ('weekly') para
--     ('weekly','biweekly','monthly','custom'). Continua sem ser RRULE:
--     cada ocorrência é uma linha real (ver lib/scheduling/recurrence.ts).
--
--   appointments.recurrence_days — dias da semana atendidos quando
--     recurrence = 'custom' (ex.: ['mon','thu']). NULL pros demais tipos.
--
--   employees.is_schedulable — backfill pra true nos funcionários
--     já cadastrados com role = 'technician' (a função deles é atender
--     agenda; deixá-los de fora era o bloqueio real da agenda "não abrir"
--     mesmo com cliente + colaborador cadastrados). Funcionários novos
--     com esse cargo já nascem is_schedulable = true (app, não banco —
--     ver apps/web/src/app/dashboard/employees/new/page.tsx).
-- ============================================================

alter table appointments drop constraint if exists appointments_recurrence_check;
alter table appointments add constraint appointments_recurrence_check
  check (recurrence in ('weekly', 'biweekly', 'monthly', 'custom'));

alter table appointments
  add column if not exists recurrence_days text[];

comment on column appointments.recurrence is
  'NULL = agendamento único. weekly/biweekly/monthly/custom = ocorrência de série recorrente (migration 032, ampliado na 035). Não é RRULE: as ocorrências são linhas reais nesta tabela.';
comment on column appointments.recurrence_days is
  'Dias da semana atendidos (ex.: {mon,thu}) quando recurrence = custom. NULL pros demais tipos, cujo dia é o da própria ocorrência.';

update employees
set is_schedulable = true
where role = 'technician'
  and is_schedulable = false;
