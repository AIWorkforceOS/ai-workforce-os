-- ============================================================
-- AI Workforce OS — Migration 59: campos do "Sign Off Sheet" fixo
-- da 360 Service Provider na ordem de serviço
--
-- Pedido do dono do produto: abandonar o carimbo em cima do arquivo
-- original de cada ordem (tentativas anteriores, migrations
-- 056/057/058) — a posição nunca saía no lugar certo pra qualquer
-- ordem. Em vez disso, o PDF baixável agora reproduz um MODELO FIXO
-- ÚNICO (o "Sign Off Sheet" real da 360), com layout e marca fixos —
-- só os dados abaixo mudam por ordem. Assinatura/nome/data vão
-- sempre pra coordenada fixa desenhada no template
-- (lib/service-orders/pdf.ts), resolvendo o problema de
-- posicionamento de vez, pra qualquer ordem.
--
-- Todos os campos abaixo são preenchidos pelo ADMIN ao anexar a
-- ordem (a IA pré-preenche via extração —
-- lib/service-orders/extraction.ts — mas sempre revisável antes de
-- salvar), nunca pelo técnico: por isso não entram em
-- ALLOWED_EMPLOYEE_UPDATE_COLUMNS nem na lista de colunas do trigger
-- appointments_guard_employee_write (migration 056) — a RLS de admin
-- (appointments_write, is_org_admin()) já cobre a escrita, sem
-- precisar de policy ou trigger novos.
-- ============================================================

alter table appointments
  add column if not exists service_order_client_po text,
  add column if not exists service_order_priority text,
  add column if not exists service_order_order_type text,
  add column if not exists service_order_ivr_pin text,
  add column if not exists service_order_location_name text,
  add column if not exists service_order_location_phone text,
  add column if not exists service_order_issuer_name text,
  add column if not exists service_order_issuer_email text;

comment on column appointments.service_order_client_po is
  'Número do PO do cliente (Client PO #), impresso no Sign Off Sheet da 360 — distinto de service_order_number (Vendor PO #, já existente desde a migration 056). Preenchido pelo admin, pré-preenchido pela extração por IA quando legível.';
comment on column appointments.service_order_priority is
  'Prioridade da ordem (ex.: "Low"), como impressa no Sign Off Sheet. Texto livre, não enumerado — o valor real usado pela contratante pode variar.';
comment on column appointments.service_order_order_type is
  'Tipo da ordem (ex.: "Interior"), como impresso no Sign Off Sheet.';
comment on column appointments.service_order_ivr_pin is
  'PIN do IVR do local do atendimento, impresso no Sign Off Sheet.';
comment on column appointments.service_order_location_name is
  'Nome/código do local do atendimento (ex.: "PB - Tanger - Loc # 6800"), distinto de appointments.address (o endereço completo) — os dois aparecem lado a lado no Sign Off Sheet.';
comment on column appointments.service_order_location_phone is
  'Telefone do local do atendimento impresso no Sign Off Sheet — frequentemente vazio no documento original.';
comment on column appointments.service_order_issuer_name is
  'Nome do contato da contratante que emitiu a ordem (ex.: "Taina Dias"), impresso no canto superior direito do Sign Off Sheet.';
comment on column appointments.service_order_issuer_email is
  'E-mail do contato da contratante que emitiu a ordem, impresso junto ao nome no Sign Off Sheet.';
