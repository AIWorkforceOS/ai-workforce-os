-- ============================================================
-- AI Workforce OS — Schema inicial
-- Agente SDR: leads, conversas, unidades
-- ============================================================

-- Extensões necessárias
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- TABELA: units (clientes do sistema — franqueados ou empresas)
-- ------------------------------------------------------------
create table if not exists units (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,                    -- ex: "smarter-campinas"
  whatsapp_instance_id text,                    -- ID da instância no Evolution API
  whatsapp_phone text,                          -- número do WhatsApp da unidade
  email_from text,                              -- ex: campinas@smarterestagios.com.br
  email_reply_to text,                          -- alias de resposta por unidade
  region_city text,                             -- cidade de atuação
  region_state text,                            -- estado de atuação
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- TABELA: leads (empresas prospectadas pelo agente)
-- ------------------------------------------------------------
create table if not exists leads (
  id uuid primary key default uuid_generate_v4(),
  unit_id uuid references units(id) on delete cascade,
  company_name text not null,
  contact_name text,
  phone text,
  email text,
  sector text,
  city text,
  state text,
  source text not null default 'google_maps',   -- google_maps | manual | referral
  status text not null default 'new',           -- new | contacted | replied | negotiating | won | lost | paused
  google_place_id text,                         -- ID do lugar no Google Maps (evita duplicatas)
  notes text,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- índice para evitar leads duplicados por unidade
create unique index if not exists leads_unit_place_idx
  on leads(unit_id, google_place_id)
  where google_place_id is not null;

-- ------------------------------------------------------------
-- TABELA: conversations (histórico de mensagens com cada lead)
-- ------------------------------------------------------------
create table if not exists conversations (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid references leads(id) on delete cascade,
  unit_id uuid references units(id) on delete cascade,
  channel text not null,                        -- whatsapp | email
  direction text not null,                      -- outbound | inbound
  content text not null,                        -- texto da mensagem
  template_key text,                            -- qual template foi usado (ex: primeiro_contato)
  external_message_id text,                     -- ID da mensagem no Evolution API ou provedor de email
  status text not null default 'sent',          -- sent | delivered | read | failed
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- TABELA: prospecting_jobs (fila de buscas por região)
-- ------------------------------------------------------------
create table if not exists prospecting_jobs (
  id uuid primary key default uuid_generate_v4(),
  unit_id uuid references units(id) on delete cascade,
  city text not null,
  state text not null,
  keywords text[] not null default array['empresa', 'industria', 'comercio'],
  status text not null default 'pending',       -- pending | running | done | failed
  total_found int not null default 0,
  total_new int not null default 0,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- FUNÇÃO: atualiza updated_at automaticamente
-- ------------------------------------------------------------
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger units_updated_at before update on units
  for each row execute function update_updated_at();

create trigger leads_updated_at before update on leads
  for each row execute function update_updated_at();
