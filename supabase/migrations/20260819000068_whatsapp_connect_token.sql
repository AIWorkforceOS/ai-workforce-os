-- ============================================================
-- Token de autorização no link público de conectar WhatsApp
-- (2026-08-19, auditoria P1.2 — segurança multi-tenant)
--
-- /connect-whatsapp/[id] e as rotas que ele chama
-- (/api/public/units/[id]/whatsapp/{connect,status}) usavam
-- createServiceClient() SEM NENHUMA autenticação — qualquer um que
-- tivesse (ou adivinhasse) o unit_id conseguia gerar um QR Code novo e
-- re-parear o WhatsApp oficial daquela unidade a um celular próprio,
-- sequestrando o canal. Corrigido para exigir um token de baixo risco
-- escopado à unidade, no mesmo padrão de units.public_lead_intake_token
-- (migration 022) — só quem tem o link completo (com token) consegue
-- conectar/consultar o WhatsApp daquela unidade específica.
-- ============================================================

alter table units
  add column if not exists whatsapp_connect_token text;

-- Backfill: toda unidade existente ganha um token novo (o link antigo,
-- sem token, deixa de funcionar — comportamento esperado e intencional).
update units set whatsapp_connect_token = uuid_generate_v4()::text
  where whatsapp_connect_token is null;

alter table units
  alter column whatsapp_connect_token set default uuid_generate_v4()::text,
  alter column whatsapp_connect_token set not null;

create unique index if not exists units_whatsapp_connect_token_uq on units(whatsapp_connect_token);

comment on column units.whatsapp_connect_token is
  'Token de baixo risco pro link público /connect-whatsapp/[id] (achado P1.2, 19/08/2026). Vazamento expõe só o pareamento de WhatsApp desta unidade, não dados — mesma classe de risco de public_lead_intake_token.';
