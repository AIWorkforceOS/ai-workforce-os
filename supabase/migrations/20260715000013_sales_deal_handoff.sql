-- ============================================================
-- AI Workforce OS — Migration 13: handoff automático do Sales Rep
-- (SDR) pro Recrutador no fechamento de negócio
--
-- O Sales Rep agora levanta, na própria conversa de WhatsApp, os dados
-- necessários pra abrir a vaga (curso, semestre, cidade/modalidade,
-- quantidade de vagas e urgência) quando o cliente confirma que quer
-- fechar de verdade. Esses dados vivem em leads.deal_profile até serem
-- usados pra criar a job_opening automaticamente — sem formulário
-- externo nem etapa manual.
-- ============================================================

alter table leads
  add column if not exists deal_profile jsonb not null default '{}'::jsonb,
  add column if not exists deal_closed_at timestamptz;

comment on column leads.deal_profile is
  'Perfil da vaga levantado pelo Sales Rep (AI) durante o fechamento — mesmos campos que o intake do Recrutador usa (course, semester_min/max, city, modality, positions_needed, urgency), coletado direto na conversa em vez de formulário externo.';
comment on column leads.deal_closed_at is
  'Marcado quando o Sales Rep identifica um fechamento real de negócio (agente configurado com business_profile.fechamento = fecha_sozinho) e dispara o handoff automático pro Recrutador.';
