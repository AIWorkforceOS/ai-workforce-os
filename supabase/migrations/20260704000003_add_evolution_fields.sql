-- ============================================================
-- AI Workforce OS — Migration 3: Campos Evolution API (WhatsApp)
-- ============================================================

alter table units
  add column if not exists evolution_api_url text,
  add column if not exists evolution_api_key text,
  add column if not exists evolution_instance_name text;
