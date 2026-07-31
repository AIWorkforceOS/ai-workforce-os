-- ============================================================
-- AI Workforce OS — Migration 51: WhatsApp por funcionário
--
-- Até aqui, uma unidade só podia ter UMA instância Evolution/UM número de
-- WhatsApp (units.evolution_instance_name/whatsapp_phone), compartilhado
-- por todos os funcionários digitais (sdr, recruiter, receptionist). Pedido
-- explícito do dono do produto: a Matriz vai operar com DOIS números reais
-- — um do Sales Rep, outro da Recepcionista — cada um dedicado a um
-- funcionário. O mecanismo abaixo é genérico por agent_type, não
-- hardcoded para a Matriz nem para os dois funcionários citados: qualquer
-- unidade pode, no futuro, dedicar uma instância a qualquer agent_type.
--
-- unit_whatsapp_channels — uma linha por (unit_id, agent_type) com
-- instância Evolution própria. Unidades que nunca configurarem um canal
-- dedicado para um agent_type continuam caindo no comportamento histórico
-- (units.evolution_instance_name/whatsapp_phone, colunas mantidas de
-- propósito como fallback — ver getEvolutionConfig/resolveWhatsappChannel
-- em lib/evolution.ts). evolution_api_url/evolution_api_key continuam em
-- `units`: são credenciais do servidor Evolution da unidade, não mudam
-- por funcionário.
--
-- Backfill: a instância/número que a unidade já tinha configurado vira o
-- canal do Sales Rep (agent_type='sdr') — é o único fluxo que hoje inicia
-- contato por conta própria (lib/leads/lead-intake.ts triggerFirstContact)
-- e, na prática, o "dono" histórico do número compartilhado.
--
-- RLS: mesma receita da migration 24 (customers) — leitura com
-- can_access_unit(unit_id); escrita humana com can_access_unit +
-- is_org_admin(); rotas de conexão/webhook rodam com service role, que
-- ignora RLS.
-- ============================================================

create table if not exists unit_whatsapp_channels (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  agent_type text not null,
  evolution_instance_name text not null,
  whatsapp_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, agent_type),
  unique (evolution_instance_name)
);

create index if not exists unit_whatsapp_channels_unit_idx on unit_whatsapp_channels(unit_id);
create index if not exists unit_whatsapp_channels_org_idx on unit_whatsapp_channels(org_id);

create trigger unit_whatsapp_channels_updated_at before update on unit_whatsapp_channels
  for each row execute function update_updated_at();

alter table unit_whatsapp_channels enable row level security;

drop policy if exists unit_whatsapp_channels_select on unit_whatsapp_channels;
create policy unit_whatsapp_channels_select on unit_whatsapp_channels
  for select using (public.can_access_unit(unit_id));

drop policy if exists unit_whatsapp_channels_write on unit_whatsapp_channels;
create policy unit_whatsapp_channels_write on unit_whatsapp_channels
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

insert into unit_whatsapp_channels (org_id, unit_id, agent_type, evolution_instance_name, whatsapp_phone)
select u.org_id, u.id, 'sdr', u.evolution_instance_name, u.whatsapp_phone
from units u
where u.evolution_instance_name is not null and u.org_id is not null
on conflict (unit_id, agent_type) do nothing;
