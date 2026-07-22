-- ============================================================
-- AI Workforce OS — Migration 32: Modo de uso + recorrência semanal
--
-- Pedido do Vinicius (2026-07-22): na configuração guiada o cliente
-- escolhe se usa o Alizo como sistema completo de gestão de empresa
-- de serviços (Clientes/Agenda/Financeiro no centro) ou só com os
-- funcionários digitais (CRM/RH/Tráfego, o modelo atual); e a agenda
-- ganha recorrência semanal simples (caso housecleaning: toda semana
-- no mesmo horário, até cancelar).
--
--   organizations.management_mode — a escolha feita na configuração
--     guiada. NULL = ainda não escolheu, comportamento atual
--     (digital_employees). A UI trata NULL como digital_employees em
--     todo lugar (fetchOrganizationManagementMode), então aplicar esta
--     migration não muda nada pra nenhuma organização existente.
--       digital_employees — só funcionários digitais (modelo atual);
--       full_management   — gestão completa: home vira painel de
--                           gestão, menu ganha Clientes/Agenda.
--     A escrita é feita por API com service role (RLS de organizations
--     só permite escrita de super_admin — mesma situação do vertical_key).
--
--   appointments.recurrence — 'weekly' quando o agendamento faz parte
--     de uma série semanal (mesmo dia da semana, mesmo horário).
--     NULL = agendamento único (todo o histórico existente).
--     Formato deliberadamente simples: não é RRULE; só existe o valor
--     'weekly' nesta fase, e as ocorrências são linhas reais em
--     appointments (geradas 12 semanas à frente na criação e estendidas
--     em +1 semana a cada conclusão — ver lib/scheduling/recurrence.ts).
--     Cada ocorrência é um agendamento normal: lembretes, "a caminho",
--     conclusão → service_records, tudo já funciona sem código novo.
--
--   appointments.recurrence_group_id — une as ocorrências da mesma
--     série (uuid gerado pela aplicação na criação da série). Usado
--     pra "cancelar esta e todas as próximas" e pra estender a série.
--
-- Sem mudança de RLS: appointments e organizations mantêm as políticas
-- existentes (007/026).
-- ============================================================

alter table organizations
  add column if not exists management_mode text
    check (management_mode in ('digital_employees', 'full_management'));

comment on column organizations.management_mode is
  'Como o cliente usa o Alizo, escolhido na configuração guiada. NULL = não escolheu ainda (tratado como digital_employees). full_management = sistema de gestão completo (Clientes/Agenda/Financeiro no centro da experiência).';

alter table appointments
  add column if not exists recurrence text check (recurrence in ('weekly')),
  add column if not exists recurrence_group_id uuid;

comment on column appointments.recurrence is
  'NULL = agendamento único. weekly = ocorrência de uma série semanal (mesmo dia/horário). Não é RRULE: as ocorrências são linhas reais nesta tabela.';
comment on column appointments.recurrence_group_id is
  'Une as ocorrências da mesma série recorrente (uuid gerado pela aplicação). Permite cancelar/estender a série inteira.';

create index if not exists appointments_recurrence_group_idx
  on appointments(recurrence_group_id) where recurrence_group_id is not null;
