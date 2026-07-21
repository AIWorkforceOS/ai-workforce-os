-- ============================================================
-- AI Workforce OS — Migration 27: Agenda Inteligente (Fase 2, sub-etapa 5/7)
--
-- Comunicação automática de agendamento — timestamps de idempotência
-- para os 3 eventos que ainda não tinham coluna própria (confirmação de
-- criação já usa confirmation_sent_at, da migration 026).
--
--   rescheduled_notified_at — null = ainda não notificado para o
--     horário atual do agendamento. O reagendamento (UI) reseta esta
--     coluna para null a cada vez que troca starts_at/ends_at, porque
--     um mesmo agendamento pode ser reagendado várias vezes e cada
--     reagendamento é um evento novo que merece seu próprio aviso —
--     diferente de confirmation_sent_at (criação só acontece uma vez).
--
--   cancelled_notified_at / no_show_notified_at — cancelamento e falta
--     são terminais na UI atual (nenhuma ação leva o agendamento de
--     volta a scheduled/confirmed), então um único carimbo (sem reset)
--     já garante "uma vez só por evento".
-- ============================================================

alter table appointments
  add column if not exists rescheduled_notified_at timestamptz,
  add column if not exists cancelled_notified_at timestamptz,
  add column if not exists no_show_notified_at timestamptz;

comment on column appointments.rescheduled_notified_at is
  'Idempotência do aviso automático de reagendamento (lib/scheduling/appointment-notifications.ts). Resetado para null a cada reagendamento.';
comment on column appointments.cancelled_notified_at is
  'Idempotência do aviso automático de cancelamento (lib/scheduling/appointment-notifications.ts). Cancelamento é terminal, então não precisa reset.';
comment on column appointments.no_show_notified_at is
  'Idempotência do registro automático de falta (lib/scheduling/appointment-notifications.ts) — apenas system_events, sem mensagem ao cliente (ver decisão documentada no handler).';
