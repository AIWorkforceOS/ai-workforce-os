-- ============================================================
-- AI Workforce OS — Migration 29: Retreinamento do funcionário digital
--
-- Até aqui a entrevista de contratação (migration 012) só rodava uma
-- vez: depois de interview_status='completed' a tela virava só leitura
-- e não existia jeito de refazer a entrevista pra atualizar o que o
-- funcionário aprendeu. Isso adiciona:
--
--   last_trained_at     → quando foi a última vez (entrevista inicial
--                          OU retreinamento) que business_profile foi
--                          atualizado
--   retrain_transcript  → conversa do retreinamento em andamento,
--                          separada de interview_transcript (que
--                          preserva o histórico da entrevista inicial).
--                          Zerada quando o retreinamento é concluído.
--
-- Importante: retreinar NÃO mexe em interview_status nem is_active —
-- o trigger enforce_interview_before_activation (migration 012) exige
-- interview_status='completed' sempre que is_active=true, então um
-- funcionário já ativo não pode ter interview_status alterado sem
-- derrubá-lo. O retreinamento atualiza business_profile diretamente e
-- deixa interview_status como já estava.
-- ============================================================

alter table agent_configs
  add column if not exists last_trained_at timestamptz,
  add column if not exists retrain_transcript jsonb not null default '[]'::jsonb;

-- Backfill best-effort para quem já concluiu a entrevista: não temos o
-- timestamp exato do momento da conclusão, updated_at é a aproximação
-- mais razoável disponível.
update agent_configs
  set last_trained_at = updated_at
  where interview_status = 'completed' and last_trained_at is null;
