-- Super Agente de Cotações — Fase 2 / migration 093 (ADITIVA; NÃO aplicada até autorização).
-- 1) Chave por unidade (off | shadow | live): só Mawi Pro entra, e em "shadow" só o admin vê a análise.
-- 2) Regras comerciais configuráveis (SOMENTE ADMIN): valor/hora cobrado, valor/hora pago ao técnico e regras
--    opcionais (hora mínima, deslocamento, markup, impostos, arredondamento). NENHUM valor fica no código e
--    nenhuma regra é inventada: campo nulo = regra inexistente (a função de custos só aplica o que estiver configurado).
--    Técnico NUNCA lê esta tabela (RLS sem policy para ele).

alter table public.units
  add column if not exists quote_ai_team_mode text not null default 'off'
  check (quote_ai_team_mode in ('off', 'shadow', 'live'));

comment on column public.units.quote_ai_team_mode is
  'Super Agente de Cotações: off = como hoje; shadow = roda mas SÓ o admin vê (piloto); live = técnicos veem. Interruptor global: env QUOTE_TEAM_ENABLED=false.';

create table if not exists public.quote_rate_cards (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete cascade,            -- null = empresa toda
  client_company text,                                                    -- null = todos os clientes (preparado para "por cliente")
  name text not null default 'Padrão',
  currency text not null default 'USD',
  billed_hourly_rate numeric(14,6),            -- cobrado do cliente por hora-homem (ex.: Facilities 360) — ADMIN
  technician_hourly_pay numeric(14,6),         -- pago ao técnico por hora-homem — ADMIN
  min_billable_hours numeric(10,4),            -- null = sem hora mínima
  travel_fee_flat numeric(14,6),               -- null = sem cobrança de deslocamento
  travel_fee_hourly numeric(14,6),
  materials_markup_pct numeric(8,4),           -- null = não aplicar markup
  tax_rules jsonb,                             -- null = não calcular imposto
  rounding_rule text check (rounding_rule is null or rounding_rule in ('cent_half_up', 'cent_up', 'cent_down', 'dollar_half_up')),  -- null = sem arredondamento
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (billed_hourly_rate is null or billed_hourly_rate >= 0),
  check (technician_hourly_pay is null or technician_hourly_pay >= 0)
);

create index if not exists quote_rate_cards_org_idx on public.quote_rate_cards (org_id, is_active, effective_from desc);

alter table public.quote_rate_cards enable row level security;

drop policy if exists quote_rate_cards_admin_all on public.quote_rate_cards;
create policy quote_rate_cards_admin_all on public.quote_rate_cards
  for all
  using (
    public.is_org_admin()
    and public.is_org_member(org_id)
    and (unit_id is null or public.can_access_unit(unit_id))
  )
  with check (
    public.is_org_admin()
    and public.is_org_member(org_id)
    and (unit_id is null or public.can_access_unit(unit_id))
  );

comment on table public.quote_rate_cards is
  'Regras comerciais do Super Agente de Cotações. SOMENTE ADMIN (RLS sem policy para funcionário). Valores são cadastrados pelo admin — nunca fixos no código.';

-- trigger genérico de updated_at para as tabelas do módulo
create or replace function public.quote_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists quote_rate_cards_updated_at on public.quote_rate_cards;
create trigger quote_rate_cards_updated_at before update on public.quote_rate_cards
  for each row execute function public.quote_set_updated_at();
