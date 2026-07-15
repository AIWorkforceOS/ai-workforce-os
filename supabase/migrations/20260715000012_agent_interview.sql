-- ============================================================
-- AI Workforce OS — Migration 12: Entrevista de contratação
--
-- Todo funcionário digital (SDR, Recrutador, Gestor de Tráfego)
-- passa por uma entrevista conduzida por IA no momento da
-- ativação: ele entrevista o dono/gestor para aprender 100% da
-- empresa antes de começar a trabalhar.
--
--   business_profile      → o que ele aprendeu (jsonb, consumido
--                           pelos prompts/estratégia de cada agente)
--   interview_status      → pending | in_progress | completed
--   interview_transcript  → histórico completo da entrevista
--
-- Regra de negócio (trigger): is_active=true só é aceito com
-- interview_status='completed'. Agentes já ativos antes desta
-- migration são considerados entrevistados (grandfather) para
-- não derrubar ninguém que já está trabalhando.
-- ============================================================

alter table agent_configs
  add column if not exists business_profile jsonb not null default '{}'::jsonb,
  add column if not exists interview_status text not null default 'pending',
  add column if not exists interview_transcript jsonb not null default '[]'::jsonb;

alter table agent_configs drop constraint if exists agent_configs_interview_status_check;
alter table agent_configs add constraint agent_configs_interview_status_check
  check (interview_status in ('pending', 'in_progress', 'completed'));

-- Funcionários que já estavam trabalhando continuam trabalhando.
update agent_configs set interview_status = 'completed' where is_active = true;

create or replace function enforce_interview_before_activation()
returns trigger as $$
begin
  if new.is_active and new.interview_status <> 'completed' then
    raise exception 'interview_required: o funcionário digital só pode ser ativado depois de concluir a entrevista de treinamento';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists agent_configs_enforce_interview on agent_configs;
create trigger agent_configs_enforce_interview
  before insert or update on agent_configs
  for each row execute function enforce_interview_before_activation();
