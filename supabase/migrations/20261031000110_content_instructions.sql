-- ============================================================
-- Migration 110 — Instruções operacionais do Gestor de Conteúdo
--
-- O dono escreve em linguagem natural ("de 01/11 a 16/11 foque em captar clientes
-- comerciais…"); o agente interpreta, confirma e guarda aqui: texto original,
-- interpretação estruturada, período, responsável e histórico de mudanças.
-- O estado (Agendada/Ativa/Pausada/Expirada/Substituída) é DERIVADO em código a partir
-- de paused + superseded_by + datas — nada de estado duplicado para ficar defasado.
--
-- Só aditiva: tabelas novas + colunas opcionais em content_posts (prova de "Instrução aplicada").
-- Nada do que já existe muda de comportamento; posts antigos ficam com as colunas nulas.
-- ============================================================

create table if not exists public.content_instructions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  original_text text not null check (length(original_text) between 3 and 4000),
  -- interpretação estruturada confirmada pelo usuário (objetivo, formatos, público, CTA, restrições…)
  interpretation jsonb not null default '{}'::jsonb,
  objective text not null,
  priority text not null default 'normal' check (priority in ('normal', 'alta')),
  starts_on date not null,
  ends_on date,
  timezone text not null default 'America/Phoenix',
  paused boolean not null default false,
  superseded_by uuid references public.content_instructions(id) on delete set null,
  conflict_notes jsonb not null default '[]'::jsonb,
  created_by text not null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists content_instructions_unit_idx on public.content_instructions(unit_id, starts_on);

create table if not exists public.content_instruction_history (
  id uuid primary key default gen_random_uuid(),
  instruction_id uuid not null references public.content_instructions(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  action text not null check (action in ('created', 'edited', 'paused', 'resumed', 'superseded', 'cancelled')),
  actor text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists content_instruction_history_idx on public.content_instruction_history(instruction_id, created_at);

alter table public.content_instructions enable row level security;
alter table public.content_instruction_history enable row level security;

drop policy if exists content_instructions_select on public.content_instructions;
create policy content_instructions_select on public.content_instructions
  for select using (public.can_access_unit(unit_id));
drop policy if exists content_instructions_write on public.content_instructions;
create policy content_instructions_write on public.content_instructions
  for all using (public.can_access_unit(unit_id) and public.is_org_admin())
  with check (public.can_access_unit(unit_id) and public.is_org_admin());

drop policy if exists content_instruction_history_select on public.content_instruction_history;
create policy content_instruction_history_select on public.content_instruction_history
  for select using (public.can_access_unit(unit_id));
drop policy if exists content_instruction_history_insert on public.content_instruction_history;
create policy content_instruction_history_insert on public.content_instruction_history
  for insert with check (public.can_access_unit(unit_id) and public.is_org_admin());

-- Prova de aplicação em cada post (exibida como "Instrução aplicada")
alter table public.content_posts
  add column if not exists instruction_id uuid references public.content_instructions(id) on delete set null,
  add column if not exists instruction_objective text,
  add column if not exists instruction_format_reason text,
  add column if not exists instruction_cta text;
