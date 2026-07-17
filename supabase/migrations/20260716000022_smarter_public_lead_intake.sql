-- ============================================================
-- AI Workforce OS — Migration 22: intake público de lead por unidade
-- (landing pages da Smarter → Sales Rep do Alizo)
--
-- Direção oposta às integrações de parceiro já existentes
-- (smarter_crm_partner_token, smarter_recruiting_partner_token): ali o
-- Alizo ESCREVE na Smarter; aqui um sistema externo (landing page da
-- Smarter com a assistente "Lia") ESCREVE um lead simples no Alizo, sem
-- login/sessão de usuário. Token de baixo risco, escopado a uma única
-- unidade, que só permite criar um lead (nome/telefone/origem) — não deve
-- ser confundido com os tokens de parceiro acima. Mesmo padrão de
-- units.intake_token (migration 4), em coluna própria para manter o
-- escopo de uso (fonte pública externa, não o intake genérico existente
-- em /api/intake/lead) separado e auditável.
-- ============================================================

alter table units
  add column if not exists public_lead_intake_token uuid not null default gen_random_uuid();

create unique index if not exists units_public_lead_intake_token_idx
  on units(public_lead_intake_token);

comment on column units.public_lead_intake_token is
  'Token público de baixo risco (Bearer) para POST /api/public/lead-intake — permite apenas criar um lead simples (nome/telefone/source) nesta unidade e disparar o primeiro contato do Sales Rep. Se vazar, o pior caso é leads falsos na unidade. Marcado manualmente, sem UI ainda (mesmo padrão de smarter_crm_partner_token).';
