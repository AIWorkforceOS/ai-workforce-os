-- ============================================================
-- AI Workforce OS — Migration 36: Biblioteca de anexos do funcionário
--
-- Pedido do produto: o cliente sobe PDFs prontos (contrato modelo,
-- apresentação, tabela de preços etc) e/ou cadastra links, escreve uma
-- instrução curta de "quando usar" para cada um, e o próprio funcionário
-- de IA decide sozinho na conversa, olhando essa instrução, se e quando
-- manda aquele material — sem gerar PDF dinamicamente (isso seria um
-- projeto à parte).
--
--   employee_attachments — biblioteca por (unit_id, agent_type): cada
--     funcionário digital (ex.: o Sales Rep de uma unidade) tem sua
--     própria lista. `usage_instructions` é o texto livre que vira
--     contexto no system prompt (lib/attachments.ts) — é isso que o
--     cliente escreve que funciona como "treinamento" de quando usar
--     aquele anexo. `kind`: 'pdf' (upload no Storage, bucket
--     employee-attachments) ou 'link' (URL externa cadastrada direto).
--
-- Nesta primeira fase o motor de conversa (lib/conversation-engine.ts)
-- só liga essa decisão para o agent_type 'sdr' (AI Sales Representative)
-- — Recruiter/Receptionist têm motores de conversa próprios
-- (lib/recruiter/*) que não foram alterados aqui. A tabela já nasce
-- genérica por agent_type para não exigir nova migration quando isso
-- for estendido.
--
-- RLS: mesma receita das migrations 007/013/024/026/030 — leitura com
-- can_access_unit(unit_id); escrita com can_access_unit + is_org_admin().
-- ============================================================

create table if not exists employee_attachments (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  agent_type text not null,
  kind text not null check (kind in ('pdf', 'link')),
  title text not null,
  usage_instructions text not null,
  file_url text not null,
  file_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column employee_attachments.agent_type is
  'agent_configs.agent_type do funcionário dono desta biblioteca (ex.: sdr). Cada funcionário tem sua própria lista de anexos.';
comment on column employee_attachments.usage_instructions is
  'Texto livre escrito pelo cliente descrevendo QUANDO enviar este material — injetado no system prompt (lib/attachments.ts) para o modelo decidir sozinho na conversa.';
comment on column employee_attachments.file_url is
  'URL pública: do arquivo no Storage (bucket employee-attachments) quando kind = pdf, ou a URL externa cadastrada quando kind = link.';
comment on column employee_attachments.file_name is
  'Nome original do arquivo (kind = pdf), usado como nome do anexo ao enviar por e-mail/WhatsApp. Null para kind = link.';

create index if not exists employee_attachments_unit_agent_idx
  on employee_attachments(unit_id, agent_type)
  where is_active;

create trigger employee_attachments_updated_at before update on employee_attachments
  for each row execute function update_updated_at();

alter table employee_attachments enable row level security;

drop policy if exists employee_attachments_select on employee_attachments;
create policy employee_attachments_select on employee_attachments
  for select using (public.can_access_unit(unit_id));

drop policy if exists employee_attachments_write on employee_attachments;
create policy employee_attachments_write on employee_attachments
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

-- ------------------------------------------------------------
-- STORAGE: bucket público para os PDFs da biblioteca de anexos
--
-- Público pelo mesmo motivo do bucket unit-logos (migration 15): os
-- canais de envio (Evolution API pro WhatsApp, Resend pro e-mail)
-- precisam buscar o arquivo direto por URL, sem o backend da Alizo
-- como intermediário. Não é dado sensível — é material que a própria
-- empresa quer que chegue ao cliente/lead (contrato modelo, tabela de
-- preços, apresentação), então expor a URL não é um risco novo.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('employee-attachments', 'employee-attachments', true)
on conflict (id) do nothing;

-- Caminho dos arquivos: {unit_id}/{filename} — mesmo padrão de
-- unit-logos: a política usa o primeiro segmento do path com
-- can_access_unit().
drop policy if exists employee_attachments_public_read on storage.objects;
create policy employee_attachments_public_read on storage.objects
  for select using (bucket_id = 'employee-attachments');

drop policy if exists employee_attachments_write_storage on storage.objects;
create policy employee_attachments_write_storage on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'employee-attachments'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
  );

drop policy if exists employee_attachments_update_storage on storage.objects;
create policy employee_attachments_update_storage on storage.objects
  for update to authenticated
  using (
    bucket_id = 'employee-attachments'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
  );

drop policy if exists employee_attachments_delete_storage on storage.objects;
create policy employee_attachments_delete_storage on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'employee-attachments'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
  );
