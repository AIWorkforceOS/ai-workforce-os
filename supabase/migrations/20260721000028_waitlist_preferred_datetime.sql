-- ============================================================
-- AI Workforce OS — Migration 28: Agenda Inteligente (Fase 2, sub-etapa 7/7)
--
-- waitlist_entries.preferred_starts_at — data/hora que o cliente
-- gostaria de ser atendido, capturada quando a busca de slots não
-- encontra vaga na tela de agendamento. Estruturado (timestamptz) pra
-- permitir ordenar/exibir a data preferida na tela de listagem da
-- waitlist; preferred_notes (já existente) continua livre pra
-- observações adicionais (ex.: "prefere período da manhã").
-- ============================================================

alter table waitlist_entries
  add column if not exists preferred_starts_at timestamptz;

comment on column waitlist_entries.preferred_starts_at is
  'Data/hora que o cliente gostaria de ser atendido (âncora, não um slot reservado). Null = sem preferência de data específica.';
