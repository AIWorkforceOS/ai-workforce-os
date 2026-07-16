-- ============================================================
-- AI Workforce OS — Migration 18: integração de CRM externo (Smarter) por unidade
--
-- Algumas unidades parceiras da Smarter Estágios já mantêm o funil de
-- vendas no CRM nativo da Smarter (sistema.smarterestagios.com.br) e
-- querem que os leads do Sales Rep (AI) sejam espelhados lá. Isso é
-- configurado por unidade — não há detecção automática por tipo de
-- negócio — e o padrão (crm_integration_mode = 'native') mantém o
-- comportamento atual (só CRM próprio do Alizo) sem nenhuma mudança.
-- ============================================================

alter table units
  add column if not exists crm_integration_mode text not null default 'native'
    check (crm_integration_mode in ('native', 'smarter')),
  add column if not exists smarter_crm_partner_token text;

comment on column units.crm_integration_mode is
  'native = CRM próprio do Alizo (padrão, sem mudança de comportamento). smarter = leads também são espelhados no CRM de parceiros da Smarter Estágios via smarter_crm_partner_token (lib/sales/smarter-crm.ts).';
comment on column units.smarter_crm_partner_token is
  'Token de parceiro (Bearer) da API de CRM da Smarter para esta unidade especificamente — segredo, nunca exposto ao client. Só é usado quando crm_integration_mode = ''smarter''. Marcado manualmente, sem UI ainda.';

alter table leads
  add column if not exists smarter_crm_lead_id text;

comment on column leads.smarter_crm_lead_id is
  'id do CrmLead correspondente no CRM da Smarter (retornado pelo POST /api/partners/leads), usado para correlacionar os PATCHs seguintes de etapa/situação/anotação. Null quando a unidade não usa integração smarter ou a sincronização inicial ainda não ocorreu/falhou.';
