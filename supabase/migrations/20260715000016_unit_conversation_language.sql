-- ============================================================
-- AI Workforce OS — Migration 16: idioma padrão de atendimento por unidade
--
-- Hoje os funcionários digitais (Sales Rep, Recrutador) sempre respondem
-- em português, não importa a unidade ou o canal — uma lacuna real para
-- unidades fora do Brasil (ex.: Mawi Services, EUA). Esta migration
-- adiciona um idioma padrão por unidade (units.default_conversation_language),
-- no mesmo molde de units.messaging_channel (migration 14): sugestão
-- automática por região, mas configurável manualmente por unidade. O
-- agente troca de idioma dinamicamente durante a conversa se o
-- lead/candidato pedir ou escrever em outro idioma.
-- ============================================================

alter table units
  add column if not exists default_conversation_language text
    check (default_conversation_language in ('en', 'pt'));

comment on column units.default_conversation_language is
  'Idioma padrão de atendimento da unidade: en ou pt. Null = padrão histórico (pt), para não quebrar unidades já em produção antes deste campo existir. O agente troca de idioma na própria conversa se o lead/candidato pedir ou escrever em outro idioma.';
